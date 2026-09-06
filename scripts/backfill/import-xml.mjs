// XML backfill CLI: streams an Apple Health export (export.zip or export.xml) into
// observations, sleep_segments and workouts via COPY. Never loads the file in memory.
//
//   node scripts/backfill/import-xml.mjs <export.zip|export.xml> --subject <uuid> [--database-url <url>]
//
// Idempotence: one import_runs row per execution, keyed by the sha256 of the input file;
// a file already imported for this subject (status 'done') is refused. All row writes
// happen in a single transaction, so a failed run leaves zero rows behind.
// Logs carry counts and type names only, never health values.
//
// Allowlist: only metric_types.supported = true is inserted; everything else is counted
// per type in import_runs.counts. Records nested inside Correlation or Workout elements
// are duplicates of top-level records (per the export DTD) and are skipped.
//
// Filling a gap: --from / --to (ISO 8601 with offset, --to exclusive) import only the
// records, sleep stages and workouts whose start falls in the window, from a NEWER export
// than the one already imported. The operator picks the window from the database (last
// imported instant on each channel), --skip-minute-types leaves the minute-regime types
// out when their window is already carried by minute_stats. Without a window a second
// full import of a newer file would duplicate every row of the first one (COPY has no
// row-level dedup against health_xml rows).
//
// A window AFTER a type's channel cutover is read from minute_stats only (architecture
// §2), so XML samples alone would leave it blank: --minute-types-to-stats derives the
// minute_stats rows from the samples of this run with the read layer's own rule (one
// winning source per UTC hour: source_priorities rank, else the watch, else the higher
// total), each sample spread over the minutes it covers in proportion to time, never
// overwriting a minute another channel already wrote. The rows are attributed to the
// type's authoritative device (channel_cutovers) and to this import run.
//
// Growing the taxonomy: --only-missing-types replays the same file for the types that
// have no XML rows yet for this subject, and only those. The set is computed from the
// database, not typed by hand, which is what makes the replay idempotent: a type that
// already holds health_xml rows is never selected, so COPY cannot duplicate it. Run it
// twice and the second run selects nothing.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { matchMultiset } from './match-multiset.mjs';
import {
  attr,
  decodeEntities,
  lines,
  normSource,
  openXmlStream,
  parseTs,
  sha256File,
  tzOffsetMin,
} from './xml-stream.mjs';

const IMPORTER_VERSION = '0.2.0';
const KCAL_TO_KJ = 4.184;
const DIST_TO_M = { km: 1000, m: 1, mi: 1609.344, yd: 0.9144, cm: 0.01, ft: 0.3048 };

// --- CLI -----------------------------------------------------------------------------

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/backfill/import-xml.mjs <export.zip|export.xml> --subject <uuid> ' +
      '[--database-url <url>] [--only-types <hk1,hk2,...> | --only-missing-types] ' +
      '[--from <iso> --to <iso>] [--skip-minute-types | --minute-types-to-stats]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let subjectId = null;
let databaseUrl = process.env.DATABASE_URL;
let onlyTypes = null; // Set<hk_identifier> | null
let onlyMissing = false; // fill onlyTypes from the database instead of the CLI
let fromMs = null; // --from: inclusive lower bound on start instant
let toMs = null; // --to: exclusive upper bound on start instant
let skipMinuteTypes = false;
let minuteTypesToStats = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--from') fromMs = Date.parse(args[++i] ?? '');
  else if (args[i] === '--to') toMs = Date.parse(args[++i] ?? '');
  else if (args[i] === '--skip-minute-types') skipMinuteTypes = true;
  else if (args[i] === '--minute-types-to-stats') minuteTypesToStats = true;
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else if (args[i] === '--only-types') onlyTypes = new Set((args[++i] ?? '').split(',').filter(Boolean));
  else if (args[i] === '--only-missing-types') onlyMissing = true;
  else if (!input) input = args[i];
  else usage(`unexpected argument: ${args[i]}`);
}
if (onlyTypes !== null && onlyTypes.size === 0) usage('--only-types needs a comma-separated list');
if (onlyTypes !== null && onlyMissing) usage('--only-types and --only-missing-types are exclusive');
if ((fromMs !== null && !Number.isFinite(fromMs)) || (toMs !== null && !Number.isFinite(toMs))) {
  usage('--from and --to must be ISO 8601 instants with an offset, e.g. 2026-08-11T16:48:06+02:00');
}
if ((fromMs === null) !== (toMs === null)) usage('--from and --to go together');
if (fromMs !== null && toMs <= fromMs) usage('--to must be after --from');
const windowed = fromMs !== null;
if (skipMinuteTypes && minuteTypesToStats) usage('--skip-minute-types and --minute-types-to-stats are exclusive');
if (minuteTypesToStats && !windowed) usage('--minute-types-to-stats needs a --from/--to window');
const inWindow = (ms) => !windowed || (Number.isFinite(ms) && ms >= fromMs && ms < toMs);
if (!input || !subjectId) usage();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
  usage('--subject must be a uuid');
}
if (!databaseUrl) usage('DATABASE_URL not set and --database-url not given');

// --- small helpers -------------------------------------------------------------------

// COPY text-format escaping for text/jsonb fields.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const N = '\\N';

function bump(map, key) { map[key] = (map[key] ?? 0) + 1; }

// --- COPY FROM STDIN on top of pg (no pg-copy-streams dependency) ----------------------
// pg's wire protocol already supports copy-in; we only need a Submittable that does not
// reply CopyFail to CopyInResponse (the default Query behavior) and exposes the connection.

class CopyInQuery extends pg.Query {
  constructor(text) {
    super({ text });
    this.ready = new Promise((res) => { this._onReady = res; });
  }
  handleCopyInResponse(connection) {
    this._copyConnection = connection;
    this._onReady();
  }
}

function startCopy(client, sql) {
  const q = new CopyInQuery(sql);
  const done = new Promise((res, rej) => { q.callback = (err, r) => (err ? rej(err) : res(r)); });
  client.query(q);
  let parts = [];
  let bytes = 0;
  let failed = null;
  done.catch((err) => { failed = err; });
  async function flush() {
    if (failed) throw failed;
    if (bytes === 0) return;
    await q.ready;
    const chunk = Buffer.from(parts.join(''), 'utf8');
    parts = [];
    bytes = 0;
    // sendCopyFromChunk does not propagate stream.write's return value, so backpressure
    // must be read from the socket itself; waiting for 'drain' unconditionally deadlocks.
    q._copyConnection.sendCopyFromChunk(chunk);
    if (q._copyConnection.stream.writableNeedDrain) {
      await new Promise((res) => q._copyConnection.stream.once('drain', res));
    }
  }
  return {
    async write(row) {
      parts.push(row);
      bytes += row.length;
      if (bytes >= 1 << 20) await flush();
    },
    async end() {
      await flush();
      await q.ready;
      q._copyConnection.endCopyFrom();
      return done;
    },
  };
}

// --- fresh-XML vs HAE dedup --------------------------------------------------------------
// The HAE worker already refuses to stage a point that matches an existing XML
// observation at ±1s (normalize-hae.ts, matched_xml). This is the same rule facing
// the other way: a fresh XML row matching an existing HAE observation is the same
// physical measurement recorded twice, and the row already in the database wins.
// Without it, replaying the export on a subject with live HAE history doubles every
// discrete value on the overlap days (--only-missing-types is the setup: the
// selected types have no XML rows by definition, but may well have HAE ones).
// Runs inside the COPY transaction, so a failed run still leaves zero rows behind.
//
// Two dedup shapes, per type:
//   - line-level multiset matching (match-multiset.mjs) for types whose HAE
//     points are the HealthKit samples themselves;
//   - the INTERVAL rule for types whose HAE points are per-minute
//     re-aggregations (MINUTE_AGGREGATED_HK): no value can pair a re-aggregate
//     with its samples, so the channel that covered a range first owns it and
//     fresh XML rows inside the HAE-covered range are dropped (covered_by_hae).
// Keep MINUTE_AGGREGATED_HK in sync with normalize-hae.ts and dedup-channels.mjs.
const MINUTE_AGGREGATED_HK = new Set([
  'HKQuantityTypeIdentifierPhysicalEffort',
  'HKQuantityTypeIdentifierTimeInDaylight',
]);

async function dedupFreshXmlAgainstHae(client, subjectId, runId, counts, nameOfTypeId) {
  // Without a single HAE row for the subject there is nothing to match: the
  // initial backfill on a fresh database skips all of this.
  const probe = await client.query(
    "select 1 from observations where subject_id = $1 and origin = 'hae' limit 1",
    [subjectId]
  );
  if (probe.rowCount === 0) return 0;

  const ranges = await client.query(
    `select type_id, min(start_ts) as lo, max(start_ts) as hi
       from observations
      where subject_id = $1 and import_run_id = $2 and value_key is not null
      group by type_id`,
    [subjectId, runId]
  );

  let dropped = 0;
  for (const r of ranges.rows) {
    const name = nameOfTypeId.get(r.type_id) ?? String(r.type_id);

    if (MINUTE_AGGREGATED_HK.has(name)) {
      const covered = await client.query(
        `delete from observations o
         using (select min(start_ts) as lo, max(start_ts) as hi
                  from observations
                 where subject_id = $1 and type_id = $2 and origin = 'hae') x
         where o.subject_id = $1 and o.type_id = $2 and o.import_run_id = $3
           and o.start_ts >= x.lo and o.start_ts <= x.hi`,
        [subjectId, r.type_id, runId]
      );
      if (covered.rowCount > 0) {
        (counts.deduped_against_hae.covered_by_hae ??= {})[name] = covered.rowCount;
        dropped += covered.rowCount;
      }
      continue;
    }

    // Intersection of the run's range with the type's HAE range, widened by the
    // ±1s match window. Empty intersection = nothing to load for this type.
    const bounds = await client.query(
      `select greatest(min(start_ts), $3::timestamptz) - interval '1 second' as lo,
              least(max(start_ts), $4::timestamptz) + interval '1 second' as hi
         from observations
        where subject_id = $1 and type_id = $2 and origin = 'hae' and value_key is not null`,
      [subjectId, r.type_id, r.lo, r.hi]
    );
    const { lo, hi } = bounds.rows[0];
    if (lo === null || hi === null || lo > hi) continue;

    const fresh = await client.query(
      `select id::text as id, source_id, start_ts, value_key::text as value_key
         from observations
        where subject_id = $1 and type_id = $2 and origin = 'health_xml'
          and import_run_id = $5 and value_key is not null
          and start_ts >= $3 and start_ts <= $4`,
      [subjectId, r.type_id, lo, hi, runId]
    );
    if (fresh.rowCount === 0) continue;
    const hae = await client.query(
      `select id::text as id, source_id, start_ts, value_key::text as value_key
         from observations
        where subject_id = $1 and type_id = $2 and origin = 'hae' and value_key is not null
          and start_ts >= $3 and start_ts <= $4`,
      [subjectId, r.type_id, lo, hi]
    );
    if (hae.rowCount === 0) continue;

    const toPts = (rows) =>
      rows.map((o) => ({
        id: o.id,
        typeId: r.type_id,
        sourceId: o.source_id,
        ts: o.start_ts.getTime(),
        valueKey: o.value_key,
      }));
    const { matched, ambiguous } = matchMultiset(toPts(fresh.rows), toPts(hae.rows), {
      haeSide: 'existing',
    });
    const toDrop = [...matched, ...ambiguous];
    if (toDrop.length === 0) continue;

    await client.query('delete from observations where id = any($1::bigint[])', [toDrop]);
    if (matched.size > 0) {
      (counts.deduped_against_hae.matched ??= {})[name] = matched.size;
    }
    if (ambiguous.size > 0) {
      (counts.deduped_against_hae.ambiguous ??= {})[name] = ambiguous.size;
    }
    dropped += toDrop.length;
  }
  return dropped;
}

// --- minute regime from XML samples -----------------------------------------------------
// Only the types with a channel cutover and only from that cutover on: before it the read
// layer uses the XML rows themselves. Same winner rule as rollup_rebuild_range (0002).
async function deriveMinuteStats(client, subjectId, runId, fromMs, toMs, counts, types) {
  const minuteTypes = [...types.entries()].filter(([, t]) => t.minute);
  for (const [hk, t] of minuteTypes) {
    const res = await client.query(
      `with bounds as (
         select c.cutover_ts, c.device_id
         from channel_cutovers c
         where c.subject_id = $1 and c.type_id = $2
       ),
       raw as (
         select o.source_id, o.start_ts, coalesce(o.end_ts, o.start_ts) as end_ts, o.value
         from observations o, bounds b
         where o.subject_id = $1 and o.type_id = $2 and o.import_run_id = $3
           and o.value is not null
           and o.start_ts >= greatest($4::timestamptz, b.cutover_ts) and o.start_ts < $5::timestamptz
       ),
       hourly as (
         select date_trunc('hour', r.start_ts) as hour_utc, r.source_id, sum(r.value) as v
         from raw r group by 1, 2
       ),
       winner as (
         select distinct on (h.hour_utc) h.hour_utc, h.source_id
         from hourly h
         join sources s on s.id = h.source_id
         left join source_priorities sp
           on sp.subject_id = $1 and sp.type_id = $2 and sp.source_id = h.source_id
         order by h.hour_utc, sp.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
       ),
       kept as (
         select r.* from raw r
         join winner w on w.hour_utc = date_trunc('hour', r.start_ts) and w.source_id = r.source_id
       ),
       spread as (
         select k.source_id, m.minute_ts,
                k.value * extract(epoch from (least(k.end_ts, m.minute_ts + interval '1 minute') - greatest(k.start_ts, m.minute_ts)))
                        / extract(epoch from (k.end_ts - k.start_ts)) as v
         from kept k
         cross join lateral generate_series(
           date_trunc('minute', k.start_ts),
           date_trunc('minute', k.end_ts - interval '1 microsecond'),
           interval '1 minute') as m(minute_ts)
         where k.end_ts > k.start_ts
         union all
         select k.source_id, date_trunc('minute', k.start_ts), k.value
         from kept k where k.end_ts <= k.start_ts
       )
       insert into minute_stats (subject_id, type_id, minute_ts, value, source_id, device_id, ingest_batch_id)
       select $1, $2, sp.minute_ts, sum(sp.v), sp.source_id, b.device_id, $3
       from spread sp, bounds b
       group by sp.minute_ts, sp.source_id, b.device_id
       having sum(sp.v) > 0
       on conflict (subject_id, type_id, minute_ts) do nothing`,
      [subjectId, t.id, runId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()]
    );
    counts.minute_types_to_stats[hk] = res.rowCount ?? 0;
  }
  const total = Object.values(counts.minute_types_to_stats).reduce((a, b) => a + b, 0);
  console.log(`minute_stats derived from the XML samples of this run: ${total} minutes over ${minuteTypes.length} types`);
}

// --- main ------------------------------------------------------------------------------

const meta = new pg.Client({ connectionString: databaseUrl }); // run bookkeeping + lookups
const copy = new pg.Client({ connectionString: databaseUrl }); // one transaction, three COPYs
await meta.connect();
await copy.connect();

let runId = null;
try {
  const subject = await meta.query('select 1 from subjects where id = $1', [subjectId]);
  if (subject.rowCount === 0) throw new Error(`subject ${subjectId} not found`);

  if (onlyMissing) {
    // A supported type this subject has no XML rows for cannot be duplicated by a
    // replay, whatever the file. Dedup is per origin (architecture.md §2), so HAE
    // rows do not protect a type: only health_xml rows do. Sleep stages land in
    // sleep_segments (XML-only by construction), never in observations, so that type
    // is judged on its own table or every replay would double the nights.
    const { rows } = await meta.query(
      `select mt.hk_identifier from metric_types mt
        where mt.supported
          and not exists (select 1 from observations o
                           where o.subject_id = $1 and o.type_id = mt.id
                             and o.origin = 'health_xml')
          and (mt.hk_identifier <> 'HKCategoryTypeIdentifierSleepAnalysis'
               or not exists (select 1 from sleep_segments s where s.subject_id = $1))
        order by mt.hk_identifier`,
      [subjectId]
    );
    onlyTypes = new Set(rows.map((r) => r.hk_identifier));
    console.log(
      `--only-missing-types: ${onlyTypes.size} supported type(s) with no XML rows for this subject` +
        (onlyTypes.size === 0 ? '' : `:\n  ${[...onlyTypes].join('\n  ')}`)
    );
    if (onlyTypes.size === 0) {
      console.log('nothing to import; leaving the database untouched');
      process.exit(0);
    }
  }

  console.log('computing sha256 of input file');
  const checksum = await sha256File(input);

  // Only this importer's runs count: import-series.mjs records its own runs on
  // the same archive (importer_version 'series-…') and reads none of the rows
  // COPY would duplicate.
  const prior = await meta.query(
    `select id, finished_at from import_runs
     where subject_id = $1 and source_sha256 = $2 and status = 'done'
       and importer_version not like 'series-%'`,
    [subjectId, checksum]
  );
  if (prior.rowCount > 0) {
    // COPY has no row-level dedup: a full re-run of an imported file would
    // duplicate every row. Re-import is only allowed in --only-types mode,
    // the "taxonomy grew, pick up newly supported types" case, where the
    // selected types are expected to have no existing rows, and in windowed
    // mode, where the operator owns the windows (each run records its own in
    // import_runs.counts.window; two runs over the same window WOULD duplicate).
    if (onlyTypes === null && !windowed) {
      console.error(
        `refusing to re-import: this file (sha256 ${checksum.toString('hex').slice(0, 12)}…) ` +
        `was already imported for this subject by run ${prior.rows[0].id} ` +
        `(use --only-types to import newly supported types from the same file)`
      );
      process.exit(1);
    }
    console.warn(
      `file already imported by run ${prior.rows[0].id}; ` +
        (windowed ? 'windowed re-import, check that the window is new' : '--only-types re-import')
    );
  }
  const stale = await meta.query(
    `select count(*)::int as n from import_runs
     where subject_id = $1 and source_sha256 = $2 and status = 'running'
       and importer_version not like 'series-%'`,
    [subjectId, checksum]
  );
  if (stale.rows[0].n > 0) {
    console.warn(`note: ${stale.rows[0].n} stale 'running' run(s) for this file (crashed before commit, no rows written)`);
  }

  runId = (await meta.query(
    `insert into import_runs (subject_id, importer_version, source_sha256)
     values ($1, $2, $3) returning id`,
    [subjectId, IMPORTER_VERSION, checksum]
  )).rows[0].id;
  console.log(`import run ${runId}`);

  // Taxonomy: ids/scales from the database, expected XML unit + factor from taxonomy.json.
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const taxonomy = JSON.parse(await readFile(join(scriptDir, '..', '..', 'db', 'taxonomy.json'), 'utf8'));
  const xmlUnitOf = new Map(taxonomy.metric_types.filter((t) => t.xml).map((t) => [t.hk_identifier, t.xml]));

  const types = new Map(); // hk_identifier -> {id, kind, supported, scale, minute}
  for (const r of (await meta.query('select id, hk_identifier, kind, supported, quantize_scale, hae_regime from metric_types')).rows) {
    types.set(r.hk_identifier, {
      id: r.id, kind: r.kind, supported: r.supported, scale: r.quantize_scale,
      minute: r.hae_regime === 'minute_cumulative',
    });
  }
  if (types.size === 0) throw new Error('metric_types is empty; run the taxonomy seed first');

  const categoryValues = new Map(); // type_id -> Map(hk_value -> raw_value)
  for (const r of (await meta.query('select type_id, raw_value, hk_value from metric_category_values')).rows) {
    if (!categoryValues.has(r.type_id)) categoryValues.set(r.type_id, new Map());
    categoryValues.get(r.type_id).set(r.hk_value, r.raw_value);
  }
  const sleepType = types.get('HKCategoryTypeIdentifierSleepAnalysis');
  const standHourType = types.get('HKCategoryTypeIdentifierAppleStandHour');

  const sourceIds = new Map((await meta.query('select id, name from sources')).rows.map((r) => [r.name, r.id]));
  async function sourceIdOf(name) {
    let id = sourceIds.get(name);
    if (id === undefined) {
      id = (await meta.query(
        'insert into sources (name) values ($1) on conflict (name) do update set name = excluded.name returning id',
        [name]
      )).rows[0].id;
      sourceIds.set(name, id);
    }
    return id;
  }
  const unitIds = new Map((await meta.query('select id, name from units')).rows.map((r) => [r.name, r.id]));
  async function unitIdOf(name) {
    let id = unitIds.get(name);
    if (id === undefined) {
      id = (await meta.query(
        'insert into units (name) values ($1) on conflict (name) do update set name = excluded.name returning id',
        [name]
      )).rows[0].id;
      unitIds.set(name, id);
    }
    return id;
  }

  const counts = {
    // What this run was allowed to write, so an operator reading import_runs later can
    // tell a full backfill from a taxonomy catch-up without guessing from the numbers.
    only_types: onlyTypes === null ? null : [...onlyTypes],
    window: windowed ? { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() } : null,
    skip_minute_types: skipMinuteTypes,
    minute_types_to_stats: minuteTypesToStats ? {} : null,
    records_seen: 0,
    observations_inserted: 0,
    sleep_segments_inserted: 0,
    workouts_inserted: 0,
    skipped: {
      not_selected: {},            // --only-types mode: supported but not in the list
      outside_window: {},          // --from/--to mode: start instant outside the window
      minute_type: {},             // --skip-minute-types: minute-regime type left out
      unsupported_type: {},        // allowlist: supported = false
      unknown_type: {},            // absent from metric_types
      nested_duplicate: {},        // Record inside Correlation/Workout (dup per DTD)
      non_numeric_value: {},       // quantity record whose value is not a number
      category_without_contract: {}, // category value missing from metric_category_values
      unit_mismatch: {},           // record unit differs from the taxonomy's expected XML unit
      invalid: {},                 // unparsable dates/offsets, non-finite values, bad workouts
      duplicate_workout_in_file: {}, // strictly identical <Workout> exported twice by Apple
    },
    // Fresh XML rows removed again before commit because an existing HAE
    // observation already carries the same measurement (±1s one-to-one match,
    // see dedupFreshXmlAgainstHae). 'ambiguous' are ties dropped rather than
    // resolved arbitrarily, mirroring normalize-hae.ts.
    deduped_against_hae: { matched: {}, ambiguous: {} },
  };

  const t0 = Date.now();
  await copy.query('begin');
  const obsCopy = startCopy(
    copy,
    `copy observations (subject_id, type_id, source_id, start_ts, end_ts, value, value_key,
       category_value, tz_offset_min, origin, original_unit_id, import_run_id) from stdin`
  );

  const sleepRows = [];   // small (thousands): buffered, COPYed after the stream
  const workoutRows = []; // small (hundreds)
  // Apple's export can contain the same <Workout> element twice (three known
  // pairs in the 2024 history). Two identical COPY lines are one workout:
  // the duplicate is counted (skipped.duplicate_workout_in_file, by activity
  // type), never inserted and never dropped silently. The id column is not in
  // the COPY line, so line equality really is strict workout equality.
  const workoutSeen = new Set();

  // Streaming parse. The export is line-structured: one element start tag per line, all
  // attributes on that line. We only track enough state to (a) skip Records nested in
  // Correlation/Workout, (b) attach WorkoutStatistics/MetadataEntry lines to the right
  // workout (and not to a nested Record/WorkoutActivity/WorkoutRoute).
  let inCorrelation = false;
  let inRecord = false;
  let inActivity = false;
  let inRoute = false;
  let workout = null;

  async function handleRecord(line) {
    counts.records_seen++;
    if (counts.records_seen % 1000000 === 0) console.log(`…${counts.records_seen} records parsed`);
    const hk = attr(line, 'type') ?? '?';
    if (inCorrelation || workout !== null) return bump(counts.skipped.nested_duplicate, hk);
    const type = types.get(hk);
    if (type === undefined) return bump(counts.skipped.unknown_type, hk);
    if (!type.supported) return bump(counts.skipped.unsupported_type, hk);
    if (onlyTypes !== null && !onlyTypes.has(hk)) return bump(counts.skipped.not_selected, hk);
    if (skipMinuteTypes && type.minute) return bump(counts.skipped.minute_type, hk);

    const startDate = attr(line, 'startDate');
    const endDate = attr(line, 'endDate');
    if (windowed && !inWindow(parseTs(startDate))) return bump(counts.skipped.outside_window, hk);
    const tz = tzOffsetMin(startDate);
    if (tz === null || tz < -900 || tz > 900) return bump(counts.skipped.invalid, hk);
    const source = await sourceIdOf(normSource(attr(line, 'sourceName') ?? '?'));
    const rawValue = attr(line, 'value');

    if (type.kind === 'category') {
      const contract = categoryValues.get(type.id);
      const rawEnum = contract?.get(rawValue);
      if (rawEnum === undefined) return bump(counts.skipped.category_without_contract, hk);
      if (type === sleepType) {
        // Raw sleep stages live in sleep_segments, not observations.
        const start = parseTs(startDate);
        const end = parseTs(endDate);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return bump(counts.skipped.invalid, hk);
        sleepRows.push(`${subjectId}\t${source}\t${rawEnum}\t${startDate}\t${endDate}\t${tz}\n`);
        counts.sleep_segments_inserted++;
        return;
      }
      await obsCopy.write(
        `${subjectId}\t${type.id}\t${source}\t${startDate}\t${endDate ?? N}\t${N}\t${N}\t${rawEnum}\t${tz}\thealth_xml\t${N}\t${runId}\n`
      );
      counts.observations_inserted++;
      return;
    }

    // quantity
    const expected = xmlUnitOf.get(hk);
    const unit = attr(line, 'unit');
    if (!expected || unit !== expected.unit) return bump(counts.skipped.unit_mismatch, hk);
    const raw = rawValue === null || rawValue === '' ? NaN : Number(rawValue);
    if (Number.isNaN(raw)) return bump(counts.skipped.non_numeric_value, hk);
    const value = raw * expected.factor;
    if (!Number.isFinite(value)) return bump(counts.skipped.invalid, hk);
    const valueKey = Math.round(value * type.scale);
    const originalUnit = await unitIdOf(unit);
    await obsCopy.write(
      `${subjectId}\t${type.id}\t${source}\t${startDate}\t${endDate ?? N}\t${value}\t${valueKey}\t${N}\t${tz}\thealth_xml\t${originalUnit}\t${runId}\n`
    );
    counts.observations_inserted++;
  }

  async function finalizeWorkout(w) {
    const start = parseTs(w.startDate);
    const end = parseTs(w.endDate);
    const tz = tzOffsetMin(w.startDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || tz === null) {
      return bump(counts.skipped.invalid, 'Workout');
    }
    if (windowed && !inWindow(start)) return bump(counts.skipped.outside_window, 'Workout');
    let durationS = null;
    if (w.duration !== null) {
      const d = Number(w.duration);
      if (Number.isFinite(d) && d >= 0) durationS = w.durationUnit === 'min' ? d * 60 : d;
    }
    if (durationS === null) durationS = (end - start) / 1000;

    let distanceM = null;
    let energyKj = null;
    const stats = {};
    for (const st of w.statistics) {
      const sum = Number(st.sum);
      if (st.sum === null || !Number.isFinite(sum)) continue;
      stats[st.type] = { sum, unit: st.unit };
      if (st.type.includes('Distance')) {
        distanceM = (distanceM ?? 0) + sum * (DIST_TO_M[st.unit] ?? 1000);
      } else if (st.type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
        energyKj = (energyKj ?? 0) + sum * (st.unit === 'kcal' ? KCAL_TO_KJ : 1);
      }
    }
    let elevationUpM = null;
    if (w.elevation !== null) {
      // MetadataEntry HKElevationAscended, e.g. "1710 cm"
      const m = /^(-?[\d.]+)\s*(cm|m)$/.exec(w.elevation);
      if (m) elevationUpM = Number(m[1]) * (m[2] === 'cm' ? 0.01 : 1);
    }
    const source = await sourceIdOf(normSource(w.sourceName ?? '?'));
    const row =
      `${subjectId}\t${esc(w.activityType ?? '?')}\t${source}\t${w.startDate}\t${w.endDate}\t${tz}\t` +
      `${w.isIndoor === null ? N : w.isIndoor ? 't' : 'f'}\t${durationS}\t${distanceM ?? N}\t${energyKj ?? N}\t` +
      `${elevationUpM ?? N}\t${esc(JSON.stringify({ statistics: stats }))}\n`;
    if (workoutSeen.has(row)) {
      const key = w.activityType ?? '?';
      counts.skipped.duplicate_workout_in_file[key] =
        (counts.skipped.duplicate_workout_in_file[key] ?? 0) + 1;
      // A `continue` sat here inside a function: the module did not even
      // parse (found 2026-09-06 by node --check).
      return;
    }
    workoutSeen.add(row);
    workoutRows.push(row);
    counts.workouts_inserted++;
  }

  console.log('streaming export');
  const { stream, wait } = openXmlStream(input);
  for await (const raw of lines(stream)) {
    let i = 0;
    while (raw.charCodeAt(i) === 32) i++; // skip indentation
    if (raw.charCodeAt(i) !== 60) continue; // not a tag line: '<'
    const line = i === 0 ? raw : raw.slice(i);

    if (line.startsWith('<Record')) {
      const wasOpen = !line.includes('/>');
      await handleRecord(line);
      if (wasOpen) inRecord = true;
    } else if (line.startsWith('</Record>')) {
      inRecord = false;
    } else if (workout !== null) {
      if (line.startsWith('<WorkoutActivity')) { if (!line.includes('/>')) inActivity = true; }
      else if (line.startsWith('</WorkoutActivity>')) inActivity = false;
      else if (line.startsWith('<WorkoutRoute')) { if (!line.includes('/>')) inRoute = true; }
      else if (line.startsWith('</WorkoutRoute>')) inRoute = false;
      else if (line.startsWith('<WorkoutStatistics') && !inActivity && !inRoute) {
        // Workout-level stats only: per-activity stats would double-count sums.
        workout.statistics.push({ type: attr(line, 'type'), sum: attr(line, 'sum'), unit: attr(line, 'unit') });
      } else if (line.startsWith('<MetadataEntry') && !inActivity && !inRoute && !inRecord) {
        const key = attr(line, 'key');
        if (key === 'HKIndoorWorkout') workout.isIndoor = attr(line, 'value') === '1';
        else if (key === 'HKElevationAscended') workout.elevation = decodeEntities(attr(line, 'value') ?? '');
      } else if (line.startsWith('</Workout>')) {
        if (!workout.skip) await finalizeWorkout(workout);
        workout = null;
        inActivity = false;
        inRoute = false;
      }
    } else if (line.startsWith('<Workout ')) {
      // Workouts have no row-level dedup either: never re-import them in
      // --only-types mode (the mode exists for metric observations only).
      if (onlyTypes !== null) {
        if (!line.endsWith('/>')) workout = { skip: true, statistics: [] };
        continue;
      }
      const w = {
        activityType: attr(line, 'workoutActivityType'),
        sourceName: attr(line, 'sourceName'),
        startDate: attr(line, 'startDate'),
        endDate: attr(line, 'endDate'),
        duration: attr(line, 'duration'),
        durationUnit: attr(line, 'durationUnit'),
        statistics: [],
        isIndoor: null,
        elevation: null,
      };
      if (line.endsWith('/>')) await finalizeWorkout(w);
      else workout = w;
    } else if (line.startsWith('<Correlation')) {
      if (!line.endsWith('/>')) inCorrelation = true;
    } else if (line.startsWith('</Correlation>')) {
      inCorrelation = false;
    }
  }
  await wait;
  console.log(`parse done in ${((Date.now() - t0) / 1000).toFixed(1)}s, finishing COPYs`);

  await obsCopy.end();
  // Same measurement, two channels: fresh XML rows matching an existing HAE
  // observation are dropped before commit, counted, never silent.
  const nameOfTypeId = new Map([...types.entries()].map(([name, t]) => [t.id, name]));
  const dedupDropped = await dedupFreshXmlAgainstHae(copy, subjectId, runId, counts, nameOfTypeId);
  if (minuteTypesToStats) await deriveMinuteStats(copy, subjectId, runId, fromMs, toMs, counts, types);
  const sleepCopy = startCopy(
    copy,
    'copy sleep_segments (subject_id, source_id, stage, start_ts, end_ts, tz_offset_min) from stdin'
  );
  for (const row of sleepRows) await sleepCopy.write(row);
  await sleepCopy.end();
  const workoutCopy = startCopy(
    copy,
    `copy workouts (subject_id, activity_type, source_id, start_ts, end_ts, tz_offset_min,
       is_indoor, duration_s, distance_m, energy_kj, elevation_up_m, stats) from stdin`
  );
  for (const row of workoutRows) await workoutCopy.write(row);
  await workoutCopy.end();
  await copy.query('commit');

  console.log('creating secondary indexes');
  await copy.query('create index if not exists observations_subject_type_start_idx on observations (subject_id, type_id, start_ts)');
  await copy.query('create index if not exists sleep_segments_subject_start_idx on sleep_segments (subject_id, start_ts)');
  await copy.query('create index if not exists workouts_subject_start_idx on workouts (subject_id, start_ts)');
  await copy.query('analyze observations');
  await copy.query('analyze sleep_segments');
  await copy.query('analyze workouts');

  await meta.query(
    `update import_runs set finished_at = now(), status = 'done', counts = $2 where id = $1`,
    [runId, counts]
  );

  const skippedTotal = Object.values(counts.skipped)
    .reduce((n, m) => n + Object.values(m).reduce((a, b) => a + b, 0), 0);
  console.log(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
    `${counts.observations_inserted} observations, ${counts.sleep_segments_inserted} sleep segments, ` +
    `${counts.workouts_inserted} workouts; ${skippedTotal} records skipped ` +
    `(detail per type in import_runs.counts, run ${runId})`
  );
  if (dedupDropped > 0) {
    console.log(
      `${dedupDropped} of those observations removed again before commit: an existing HAE ` +
      `observation already carries the same measurement (deduped_against_hae in import_runs.counts)`
    );
  }
  // A bulk COPY writes behind the rollups' back: nothing invalidated them.
  if (counts.observations_inserted > 0) {
    console.log(
      `rollups are now stale for this subject. Rebuild them with:\n` +
      `  npm run rollups -- --subject ${subjectId}` +
      (onlyTypes === null ? '' : ` --types ${[...onlyTypes].join(',')}`)
    );
  }
} catch (err) {
  if (runId !== null) {
    try { await copy.query('rollback'); } catch { /* connection may be gone */ }
    await meta.query(
      `update import_runs set finished_at = now(), status = 'failed', counts = $2 where id = $1`,
      [runId, { error: String(err?.message ?? err) }]
    ).catch(() => {});
  }
  throw err;
} finally {
  await meta.end().catch(() => {});
  await copy.end().catch(() => {});
}
