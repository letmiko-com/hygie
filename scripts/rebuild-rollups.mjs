// Rebuilds rollup_hourly for one subject from the sources of truth.
//
//   node scripts/rebuild-rollups.mjs --subject <uuid> [--types <hk1,hk2,...>]
//                                    [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//                                    [--database-url <url>]
//
// WHEN TO RUN IT: after an XML backfill (scripts/backfill/import-xml.mjs), after
// moving a channel cutover by hand, or after any bulk write that did not go
// through the ingestion worker. Those writes add observations behind the rollups'
// back; nothing else invalidates them. The worker keeps rollups current for HAE
// batches on its own and needs no help.
//
// It calls the same SQL builder as the worker (rollup_rebuild_range, migration
// 0002), one call per month per type so no transaction is ever long, and it is
// idempotent: run it twice, get the same rollups. Rollups are derived data, so
// the worst case of running it too often is wasted CPU.
// Logs carry type names, hour counts and durations only, never health values.
import pg from 'pg';

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/rebuild-rollups.mjs --subject <uuid> [--types <hk1,hk2,...>] ' +
      '[--from YYYY-MM-DD] [--to YYYY-MM-DD] [--database-url <url>]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let subjectId = null;
let types = null;
let from = null;
let to = null;
let databaseUrl = process.env.DATABASE_URL;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--types') types = (args[++i] ?? '').split(',').filter(Boolean);
  else if (args[i] === '--from') from = args[++i];
  else if (args[i] === '--to') to = args[++i];
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else usage(`unexpected argument: ${args[i]}`);
}
if (!subjectId) usage();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
  usage('--subject must be a uuid');
}
for (const [name, v] of [['--from', from], ['--to', to]]) {
  if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) usage(`${name} must be YYYY-MM-DD`);
}
if (types !== null && types.length === 0) usage('--types needs a comma-separated list');
if (!databaseUrl) usage('DATABASE_URL not set and --database-url not given');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

/** First day of the next UTC month. */
function nextMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
function monthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

try {
  const subject = await client.query('select id from subjects where id = $1', [subjectId]);
  if (subject.rowCount === 0) {
    console.error(`subject ${subjectId} does not exist`);
    process.exit(1);
  }

  // Candidate types: every quantity type with data for this subject. Category
  // types have no numeric value and are never rolled up.
  const { rows: candidates } = await client.query(
    `select mt.id, mt.hk_identifier, mt.hae_regime,
            least(o.min_ts, m.min_ts) as min_ts,
            greatest(o.max_ts, m.max_ts) as max_ts
     from metric_types mt
     left join lateral (
       select min(start_ts) as min_ts, max(start_ts) as max_ts
       from observations o
       where o.subject_id = $1 and o.type_id = mt.id and o.value is not null
     ) o on true
     left join lateral (
       select min(minute_ts) as min_ts, max(minute_ts) as max_ts
       from minute_stats m
       where m.subject_id = $1 and m.type_id = mt.id
     ) m on true
     where mt.kind = 'quantity'
       and ($2::text[] is null or mt.hk_identifier = any($2::text[]))
       and (o.min_ts is not null or m.min_ts is not null)
     order by mt.hk_identifier`,
    [subjectId, types]
  );
  if (candidates.length === 0) {
    console.log('nothing to rebuild: no quantity data for this subject');
    process.exit(0);
  }

  const t0 = Date.now();
  let totalHours = 0;
  for (const type of candidates) {
    let start = monthStart(type.min_ts);
    let end = new Date(type.max_ts.getTime() + 3600_000); // include the last hour
    if (from !== null) {
      const f = new Date(`${from}T00:00:00Z`);
      if (f > start) start = monthStart(f);
    }
    if (to !== null) {
      const t = new Date(`${to}T00:00:00Z`);
      if (t < end) end = t;
    }
    if (end <= start) continue;

    const tType = Date.now();
    let hours = 0;
    for (let cur = start; cur < end; cur = nextMonth(cur)) {
      const stop = nextMonth(cur) < end ? nextMonth(cur) : end;
      const res = await client.query(
        'select rollup_rebuild_range($1, $2::smallint, $3, $4) as n',
        [subjectId, type.id, cur, stop]
      );
      hours += res.rows[0].n;
    }
    // The queue entries for the window we just rebuilt are now redundant.
    const dropped = await client.query(
      `delete from rollup_dirty_ranges
       where subject_id = $1 and type_id = $2 and from_ts >= $3 and to_ts <= $4`,
      [subjectId, type.id, start, end]
    );
    totalHours += hours;
    console.log(
      `${type.hk_identifier}: ${hours} hours in ${((Date.now() - tType) / 1000).toFixed(1)}s` +
        (dropped.rowCount ? `, ${dropped.rowCount} queued ranges dropped` : '')
    );
  }
  console.log(
    `done: ${totalHours} rollup hours over ${candidates.length} types in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
} finally {
  await client.end();
}
