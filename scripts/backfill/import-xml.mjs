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
// Growing the taxonomy: --only-missing-types replays the same file for the types that
// have no XML rows yet for this subject, and only those. The set is computed from the
// database, not typed by hand, which is what makes the replay idempotent: a type that
// already holds health_xml rows is never selected, so COPY cannot duplicate it. Run it
// twice and the second run selects nothing.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const IMPORTER_VERSION = '0.1.0';
const KCAL_TO_KJ = 4.184;
const DIST_TO_M = { km: 1000, m: 1, mi: 1609.344, yd: 0.9144, cm: 0.01, ft: 0.3048 };

// --- CLI -----------------------------------------------------------------------------

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/backfill/import-xml.mjs <export.zip|export.xml> --subject <uuid> ' +
      '[--database-url <url>] [--only-types <hk1,hk2,...> | --only-missing-types]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let subjectId = null;
let databaseUrl = process.env.DATABASE_URL;
let onlyTypes = null; // Set<hk_identifier> | null
let onlyMissing = false; // fill onlyTypes from the database instead of the CLI
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else if (args[i] === '--only-types') onlyTypes = new Set((args[++i] ?? '').split(',').filter(Boolean));
  else if (args[i] === '--only-missing-types') onlyMissing = true;
  else if (!input) input = args[i];
  else usage(`unexpected argument: ${args[i]}`);
}
if (onlyTypes !== null && onlyTypes.size === 0) usage('--only-types needs a comma-separated list');
if (onlyTypes !== null && onlyMissing) usage('--only-types and --only-missing-types are exclusive');
if (!input || !subjectId) usage();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
  usage('--subject must be a uuid');
}
if (!databaseUrl) usage('DATABASE_URL not set and --database-url not given');

// --- small helpers -------------------------------------------------------------------

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    if (ENTITIES[m] !== undefined) return ENTITIES[m];
    return String.fromCodePoint(m[2] === 'x' || m[2] === 'X' ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10));
  });
}

function attr(line, name) {
  const probe = ` ${name}="`;
  const i = line.indexOf(probe);
  if (i < 0) return null;
  const start = i + probe.length;
  const end = line.indexOf('"', start);
  return end < 0 ? null : line.slice(start, end);
}

// "2024-01-15 07:30:00 +0200" -> minutes; null when unparsable.
function tzOffsetMin(date) {
  if (!date || date.length < 5) return null;
  const off = date.slice(-5);
  const sign = off[0] === '-' ? -1 : off[0] === '+' ? 1 : null;
  if (sign === null) return null;
  const h = Number(off.slice(1, 3));
  const m = Number(off.slice(3, 5));
  return Number.isFinite(h) && Number.isFinite(m) ? sign * (h * 60 + m) : null;
}

function parseTs(date) {
  // "YYYY-MM-DD HH:MM:SS ±HHMM" (same string Postgres accepts as timestamptz input)
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/.exec(date ?? '');
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}`) : NaN;
}

// U+00A0 -> space, control whitespace -> space, trim (same rule as the HAE adapter).
const normSource = (name) => decodeEntities(name).replace(/ /g, ' ').replace(/[\t\n\r]/g, ' ').trim();

// COPY text-format escaping for text/jsonb fields.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
const N = '\\N';

function bump(map, key) { map[key] = (map[key] ?? 0) + 1; }

async function* lines(stream) {
  let rest = '';
  for await (const chunk of stream) {
    const data = rest + chunk;
    let start = 0;
    let i;
    while ((i = data.indexOf('\n', start)) >= 0) {
      yield data.slice(start, i);
      start = i + 1;
    }
    rest = data.slice(start);
  }
  if (rest) yield rest;
}

function openXmlStream(path) {
  if (!path.endsWith('.zip')) {
    const s = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
    return { stream: s, wait: new Promise((res, rej) => { s.on('end', res); s.on('error', rej); }) };
  }
  // Apple's zip contains apple_health_export/export.xml; stream it without extracting.
  const child = spawn('unzip', ['-p', path, '*export.xml'], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  const wait = new Promise((res, rej) => {
    child.on('error', (e) => rej(e.code === 'ENOENT' ? new Error('unzip binary not found; extract the archive manually') : e));
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`unzip exited with code ${code}`))));
  });
  return { stream: child.stdout, wait };
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path, { highWaterMark: 1 << 20 })
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest()))
      .on('error', reject);
  });
}

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

  const prior = await meta.query(
    `select id, finished_at from import_runs
     where subject_id = $1 and source_sha256 = $2 and status = 'done'`,
    [subjectId, checksum]
  );
  if (prior.rowCount > 0) {
    // COPY has no row-level dedup: a full re-run of an imported file would
    // duplicate every row. Re-import is only allowed in --only-types mode,
    // the "taxonomy grew, pick up newly supported types" case, where the
    // selected types are expected to have no existing rows.
    if (onlyTypes === null) {
      console.error(
        `refusing to re-import: this file (sha256 ${checksum.toString('hex').slice(0, 12)}…) ` +
        `was already imported for this subject by run ${prior.rows[0].id} ` +
        `(use --only-types to import newly supported types from the same file)`
      );
      process.exit(1);
    }
    console.warn(`file already imported by run ${prior.rows[0].id}; --only-types re-import`);
  }
  const stale = await meta.query(
    `select count(*)::int as n from import_runs
     where subject_id = $1 and source_sha256 = $2 and status = 'running'`,
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

  const types = new Map(); // hk_identifier -> {id, kind, supported, scale}
  for (const r of (await meta.query('select id, hk_identifier, kind, supported, quantize_scale from metric_types')).rows) {
    types.set(r.hk_identifier, { id: r.id, kind: r.kind, supported: r.supported, scale: r.quantize_scale });
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
    records_seen: 0,
    observations_inserted: 0,
    sleep_segments_inserted: 0,
    workouts_inserted: 0,
    skipped: {
      not_selected: {},            // --only-types mode: supported but not in the list
      unsupported_type: {},        // allowlist: supported = false
      unknown_type: {},            // absent from metric_types
      nested_duplicate: {},        // Record inside Correlation/Workout (dup per DTD)
      non_numeric_value: {},       // quantity record whose value is not a number
      category_without_contract: {}, // category value missing from metric_category_values
      unit_mismatch: {},           // record unit differs from the taxonomy's expected XML unit
      invalid: {},                 // unparsable dates/offsets, non-finite values, bad workouts
    },
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

    const startDate = attr(line, 'startDate');
    const endDate = attr(line, 'endDate');
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
    workoutRows.push(
      `${subjectId}\t${esc(w.activityType ?? '?')}\t${source}\t${w.startDate}\t${w.endDate}\t${tz}\t` +
      `${w.isIndoor === null ? N : w.isIndoor ? 't' : 'f'}\t${durationS}\t${distanceM ?? N}\t${energyKj ?? N}\t` +
      `${elevationUpM ?? N}\t${esc(JSON.stringify({ statistics: stats }))}\n`
    );
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
