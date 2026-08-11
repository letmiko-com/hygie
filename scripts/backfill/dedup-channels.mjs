// One-shot cleanup of cross-channel duplicates on raw_discrete types.
//
//   node scripts/backfill/dedup-channels.mjs --subject <uuid> [--database-url <url>] [--apply]
//
// WHY IT EXISTS: until importer 0.2.0 the XML backfill inserted its rows without
// looking at the HAE history, so a replay on a subject with live HAE data (the
// --only-missing-types catch-up of 2026-08-04 is the known case) wrote the same
// physical measurement twice — one health_xml row, one hae row — on the overlap
// days, and every discrete sum on those days doubled. The importer now refuses
// those rows at import time (dedupFreshXmlAgainstHae); this script repairs what
// was written before that guard existed.
//
// RULE, identical to both importers: one-to-one multiset matching per
// (type, source, value_key) at ±1s plus the HAE minute-truncation window —
// see match-multiset.mjs. The channel that reached the database FIRST wins
// (measured per type by min(ingested_at) on the overlap); matched and
// ambiguous rows of the later channel are deleted. Types whose HAE points are
// per-minute RE-AGGREGATIONS (MINUTE_AGGREGATED_HK, kept in sync with
// normalize-hae.ts and import-xml.mjs) cannot be matched line by line and
// follow the interval rule instead: the later channel's rows inside the first
// channel's covered range are deleted. Everything is counted per type and
// printed; nothing is ever removed silently.
//
// DRY-RUN by default: prints the full report and touches nothing. --apply
// deletes and prints the targeted rollup rebuild command; rollups are NOT
// rebuilt here (derived data, explicit step, same discipline as the backfill).
// Logs carry counts, type names and dates only, never health values.
import pg from 'pg';
import { matchMultiset } from './match-multiset.mjs';

const MINUTE_AGGREGATED_HK = new Set([
  'HKQuantityTypeIdentifierPhysicalEffort',
  'HKQuantityTypeIdentifierTimeInDaylight',
]);

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/backfill/dedup-channels.mjs --subject <uuid> [--database-url <url>] [--apply]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let subjectId = null;
let databaseUrl = process.env.DATABASE_URL;
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else if (args[i] === '--apply') apply = true;
  else usage(`unknown argument: ${args[i]}`);
}
if (!subjectId) usage('--subject is required');
if (!databaseUrl) usage('DATABASE_URL or --database-url is required');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const subject = await client.query('select 1 from subjects where id = $1', [subjectId]);
  if (subject.rowCount === 0) throw new Error(`subject ${subjectId} not found`);

  // Types holding rows from BOTH origins: the only place a duplicate can live.
  const both = await client.query(
    `select o.type_id, mt.hk_identifier
       from observations o
       join metric_types mt on mt.id = o.type_id
      where o.subject_id = $1 and o.value_key is not null
      group by o.type_id, mt.hk_identifier
     having count(*) filter (where o.origin = 'health_xml') > 0
        and count(*) filter (where o.origin = 'hae') > 0
      order by mt.hk_identifier`,
    [subjectId]
  );
  console.log(`${both.rowCount} quantity type(s) hold rows from both channels`);

  // Category types cannot be matched (no value_key). Report if both channels
  // ever wrote one — expected 0, the HAE raw regime stages quantities only.
  const cat = await client.query(
    `select mt.hk_identifier, count(*) filter (where o.origin = 'hae') as hae_rows
       from observations o
       join metric_types mt on mt.id = o.type_id
      where o.subject_id = $1 and o.category_value is not null
      group by mt.hk_identifier
     having count(*) filter (where o.origin = 'health_xml') > 0
        and count(*) filter (where o.origin = 'hae') > 0`,
    [subjectId]
  );
  if (cat.rowCount > 0) {
    console.warn(
      `NOTE: ${cat.rowCount} category type(s) hold rows from both channels and are NOT ` +
      `handled here (no value_key to match on): ${cat.rows.map((r) => r.hk_identifier).join(', ')}`
    );
  }

  let totalDrop = 0;
  let dayLo = null;
  let dayHi = null;
  const touchedTypes = [];

  if (apply) await client.query('begin');

  for (const t of both.rows) {
    // Overlap window of the two channels, widened by the ±1s match window.
    const bounds = await client.query(
      `select greatest(min(start_ts) filter (where origin = 'health_xml'),
                       min(start_ts) filter (where origin = 'hae')) - interval '1 second' as lo,
              least(max(start_ts) filter (where origin = 'health_xml'),
                    max(start_ts) filter (where origin = 'hae')) + interval '1 second' as hi
         from observations
        where subject_id = $1 and type_id = $2 and value_key is not null`,
      [subjectId, t.type_id]
    );
    const { lo, hi } = bounds.rows[0];
    if (lo === null || hi === null || lo > hi) continue;

    const rows = await client.query(
      `select id::text as id, origin, source_id, start_ts, value_key::text as value_key,
              ingested_at
         from observations
        where subject_id = $1 and type_id = $2 and value_key is not null
          and start_ts >= $3 and start_ts <= $4`,
      [subjectId, t.type_id, lo, hi]
    );
    const xml = rows.rows.filter((r) => r.origin === 'health_xml');
    const hae = rows.rows.filter((r) => r.origin === 'hae');
    if (xml.length === 0 || hae.length === 0) continue;

    // First writer wins: the channel that reached the database later on this
    // overlap is the incoming side, and its matched rows are the duplicates.
    const minIngest = (arr) => Math.min(...arr.map((r) => r.ingested_at.getTime()));
    const xmlSecond = minIngest(xml) >= minIngest(hae);
    const incoming = xmlSecond ? xml : hae;
    const existing = xmlSecond ? hae : xml;

    let matched;
    let ambiguous = new Set();
    if (MINUTE_AGGREGATED_HK.has(t.hk_identifier)) {
      // Interval rule: the first channel owns its covered range; every later
      // row inside it re-describes the same reality in an unmatchable shape.
      const tsList = existing.map((r) => r.start_ts.getTime());
      const eLo = Math.min(...tsList);
      const eHi = Math.max(...tsList);
      matched = new Set(
        incoming
          .filter((r) => r.start_ts.getTime() >= eLo && r.start_ts.getTime() <= eHi)
          .map((r) => r.id)
      );
    } else {
      const toPts = (arr) =>
        arr.map((o) => ({
          id: o.id,
          typeId: t.type_id,
          sourceId: o.source_id,
          ts: o.start_ts.getTime(),
          valueKey: o.value_key,
        }));
      ({ matched, ambiguous } = matchMultiset(toPts(incoming), toPts(existing), {
        haeSide: xmlSecond ? 'existing' : 'incoming',
      }));
    }
    const toDrop = [...matched, ...ambiguous];
    if (toDrop.length === 0) continue;

    const dropDays = new Set(
      incoming
        .filter((r) => matched.has(r.id) || ambiguous.has(r.id))
        .map((r) => r.start_ts.toISOString().slice(0, 10))
    );
    const days = [...dropDays].sort();
    if (dayLo === null || days[0] < dayLo) dayLo = days[0];
    if (dayHi === null || days[days.length - 1] > dayHi) dayHi = days[days.length - 1];
    touchedTypes.push(t.hk_identifier);
    totalDrop += toDrop.length;

    const word = MINUTE_AGGREGATED_HK.has(t.hk_identifier) ? 'interval-covered' : 'matched';
    console.log(
      `${t.hk_identifier}: drop ${matched.size} ${word}` +
      (ambiguous.size > 0 ? ` + ${ambiguous.size} ambiguous` : '') +
      ` ${xmlSecond ? 'health_xml' : 'hae'} row(s)` +
      ` (overlap ${xml.length} xml / ${hae.length} hae, days ${days.join(', ')})`
    );

    if (apply) {
      await client.query('delete from observations where id = any($1::bigint[])', [toDrop]);
    }
  }

  if (totalDrop === 0) {
    console.log('no cross-channel duplicates found; nothing to do');
    if (apply) await client.query('commit');
  } else if (!apply) {
    console.log(`DRY-RUN: ${totalDrop} row(s) would be deleted; re-run with --apply`);
  } else {
    await client.query('commit');
    // UTC day bounds widened by one day cover every timezone's local-day edges.
    const d = (day, n) =>
      new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    console.log(
      `deleted ${totalDrop} row(s). Rollups are now stale on the touched range; rebuild:\n` +
      `  node scripts/rebuild-rollups.mjs --subject ${subjectId} \\\n` +
      `    --types ${touchedTypes.join(',')} \\\n` +
      `    --from ${d(dayLo, -1)} --to ${d(dayHi, 1)}`
    );
  }
} catch (err) {
  if (apply) await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end().catch(() => {});
}
