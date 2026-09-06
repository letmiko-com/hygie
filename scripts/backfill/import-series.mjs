// Series backfill from an Apple Health export, run AFTER import-xml.mjs on the
// same archive: activity rings and audiograms from export.xml, GPS routes from
// the GPX files a workout references, ECGs from the CSV files. Everything is
// idempotent by identity (a day of rings upserts, a route point is unique per
// workout and timestamp, an ECG or audiogram is unique per source and start
// second), so re-running on the same or a newer export is safe.
//
//   node scripts/backfill/import-series.mjs <export.zip|export.xml> --subject <uuid>
//        [--database-url <url>] [--only rings,audiograms,routes,ecg]
//
// Routes attach to the workouts import-xml.mjs (or a channel) already wrote,
// matched on activity and start instant (±1 s, exactly one candidate). Logs
// carry counts only, never values; the personal header lines of an ECG CSV
// (name, date of birth) are never read past the field they sit in.
import pg from 'pg';
import { attr, decodeEntities, exportFiles, lines, normSource, openXmlStream, parseTs, sha256File, tzOffsetMin } from './xml-stream.mjs';

const IMPORTER_VERSION = 'series-0.1.0';
const KCAL_TO_KJ = 4.184;
const SECTIONS = ['rings', 'audiograms', 'routes', 'ecg'];
const EXPORT_SOURCE = 'Apple Health export';

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/backfill/import-series.mjs <export.zip|export.xml> --subject <uuid> ' +
      '[--database-url <url>] [--only rings,audiograms,routes,ecg]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let subjectId = null;
let databaseUrl = process.env.DATABASE_URL;
let only = new Set(SECTIONS);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else if (args[i] === '--only') only = new Set((args[++i] ?? '').split(',').filter(Boolean));
  else if (!input) input = args[i];
  else usage(`unexpected argument: ${args[i]}`);
}
if (!input || !subjectId) usage();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) usage('--subject must be a uuid');
for (const s of only) if (!SECTIONS.includes(s)) usage(`unknown section: ${s}`);
if (!databaseUrl) usage('DATABASE_URL not set and --database-url not given');

const isoOf = (ms) => new Date(ms).toISOString();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const counts = {
  rings: { seen: 0, inserted: 0, updated: 0, unchanged: 0, skipped_invalid: 0 },
  audiograms: { seen: 0, inserted: 0, deduped: 0, skipped_invalid: 0, points_inserted: 0 },
  routes: { referenced: 0, workout_matched: 0, workout_unmatched: 0, workout_ambiguous: 0, file_missing: 0, points_inserted: 0, points_duplicate: 0, points_skipped: 0 },
  ecg: { files: 0, inserted: 0, deduped: 0, skipped_invalid: 0 },
};
let runId = null;
const t0 = Date.now();
try {
  if ((await client.query('select 1 from subjects where id = $1', [subjectId])).rowCount === 0) {
    throw new Error(`subject ${subjectId} not found`);
  }
  console.log('computing sha256 of input file');
  const checksum = await sha256File(input);
  runId = (await client.query(
    `insert into import_runs (subject_id, importer_version, source_sha256) values ($1, $2, $3) returning id`,
    [subjectId, IMPORTER_VERSION, checksum]
  )).rows[0].id;
  console.log(`import run ${runId}, sections: ${[...only].join(', ')}`);

  const sourceIds = new Map((await client.query('select id, name from sources')).rows.map((r) => [r.name, r.id]));
  async function sourceIdOf(rawName) {
    const name = normSource(rawName ?? '') || EXPORT_SOURCE;
    if (sourceIds.has(name)) return sourceIds.get(name);
    const { rows } = await client.query(
      'insert into sources (name) values ($1) on conflict (name) do update set name = excluded.name returning id',
      [name]
    );
    sourceIds.set(name, rows[0].id);
    return rows[0].id;
  }

  // --- pass over export.xml ----------------------------------------------------------
  const rings = [];
  const audiograms = [];
  const routeRefs = [];
  let audiogram = null;
  let workout = null;
  const needXml = only.has('rings') || only.has('audiograms') || only.has('routes');
  if (needXml) {
    console.log('streaming export.xml');
    const { stream, wait } = openXmlStream(input);
    for await (const raw of lines(stream)) {
      let i = 0;
      while (raw.charCodeAt(i) === 32) i++;
      if (raw.charCodeAt(i) !== 60) continue;
      const line = i === 0 ? raw : raw.slice(i);

      if (line.startsWith('<ActivitySummary ')) {
        if (only.has('rings')) rings.push(line);
      } else if (line.startsWith('<Audiogram ')) {
        audiogram = { line, points: [] };
        if (line.endsWith('/>')) { audiograms.push(audiogram); audiogram = null; }
      } else if (audiogram !== null) {
        if (line.startsWith('<SensitivityPoint')) audiogram.points.push({ line, tests: [] });
        else if (line.startsWith('<SensitivityTest') && audiogram.points.length > 0) audiogram.points.at(-1).tests.push(line);
        else if (line.startsWith('</Audiogram>')) { audiograms.push(audiogram); audiogram = null; }
      } else if (line.startsWith('<Workout ')) {
        workout = { activity: attr(line, 'workoutActivityType'), start: attr(line, 'startDate'), source: attr(line, 'sourceName'), route: null };
        if (line.endsWith('/>')) workout = null;
      } else if (workout !== null) {
        if (line.startsWith('<WorkoutRoute')) workout.route = { source: attr(line, 'sourceName'), path: null };
        else if (line.startsWith('<FileReference') && workout.route) workout.route.path = decodeEntities(attr(line, 'path') ?? '');
        else if (line.startsWith('</Workout>')) {
          if (workout.route?.path && only.has('routes')) routeRefs.push(workout);
          workout = null;
        }
      }
    }
    await wait;
    console.log(`parsed: ${rings.length} activity summaries, ${audiograms.length} audiograms, ${routeRefs.length} workouts with a route file`);
  }

  // --- rings -----------------------------------------------------------------------------
  if (only.has('rings')) {
    const sourceId = await sourceIdOf(EXPORT_SOURCE);
    for (const line of rings) {
      counts.rings.seen++;
      const day = attr(line, 'dateComponents');
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { counts.rings.skipped_invalid++; continue; }
      const energyUnit = (attr(line, 'activeEnergyBurnedUnit') ?? 'Cal').toLowerCase();
      const toKj = energyUnit === 'kj' ? 1 : KCAL_TO_KJ; // Apple writes "Cal" for kcal
      const kj = (v) => (v === null ? null : v * toKj);
      const moveGoalKj = kj(num(attr(line, 'activeEnergyBurnedGoal')));
      const moveTimeGoal = num(attr(line, 'appleMoveTimeGoal'));
      const moveMode = (moveGoalKj === null || moveGoalKj === 0) && moveTimeGoal !== null && moveTimeGoal > 0 ? 'time' : 'energy';
      const goal = (v) => (v !== null && v > 0 ? v : null);
      const res = await client.query(
        `insert into activity_summaries
           (subject_id, day, move_mode, move_kj, move_goal_kj, move_time_min, move_time_goal_min,
            exercise_min, exercise_goal_min, stand_h, stand_goal_h, paused, source_id)
         values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
         on conflict (subject_id, day) do update set
           move_mode = excluded.move_mode, move_kj = excluded.move_kj, move_goal_kj = excluded.move_goal_kj,
           move_time_min = excluded.move_time_min, move_time_goal_min = excluded.move_time_goal_min,
           exercise_min = excluded.exercise_min, exercise_goal_min = excluded.exercise_goal_min,
           stand_h = excluded.stand_h, stand_goal_h = excluded.stand_goal_h,
           source_id = excluded.source_id, updated_at = now()
         where (activity_summaries.move_mode, activity_summaries.move_kj, activity_summaries.move_goal_kj,
                activity_summaries.move_time_min, activity_summaries.move_time_goal_min,
                activity_summaries.exercise_min, activity_summaries.exercise_goal_min,
                activity_summaries.stand_h, activity_summaries.stand_goal_h)
               is distinct from
               (excluded.move_mode, excluded.move_kj, excluded.move_goal_kj,
                excluded.move_time_min, excluded.move_time_goal_min,
                excluded.exercise_min, excluded.exercise_goal_min,
                excluded.stand_h, excluded.stand_goal_h)
         returning (xmax = 0) as inserted`,
        [
          subjectId, day, moveMode,
          kj(num(attr(line, 'activeEnergyBurned'))), goal(moveGoalKj),
          num(attr(line, 'appleMoveTime')), goal(moveTimeGoal),
          num(attr(line, 'appleExerciseTime')), goal(num(attr(line, 'appleExerciseTimeGoal'))),
          num(attr(line, 'appleStandHours')), goal(num(attr(line, 'appleStandHoursGoal'))),
          sourceId,
        ]
      );
      const row = res.rows[0];
      counts.rings[row === undefined ? 'unchanged' : row.inserted ? 'inserted' : 'updated']++;
    }
  }

  // --- audiograms ------------------------------------------------------------------------
  if (only.has('audiograms')) {
    for (const a of audiograms) {
      counts.audiograms.seen++;
      const startMs = parseTs(attr(a.line, 'startDate'));
      const endMs = parseTs(attr(a.line, 'endDate'));
      const tz = tzOffsetMin(attr(a.line, 'startDate'));
      const points = new Map();
      for (const p of a.points) {
        const hz = num(attr(p.line, 'frequencyValue'));
        if (hz === null || hz <= 0) continue;
        // Older exports: one value per ear on the point; newer ones: nested tests.
        for (const [side, key] of [['left', 'leftEarValue'], ['right', 'rightEarValue']]) {
          const v = num(attr(p.line, key));
          if (v !== null) points.set(`${side}|${hz}|false`, [side, hz, v, false, 'air', null]);
        }
        for (const t of p.tests) {
          const v = num(attr(t, 'sensitivityValue') ?? attr(t, 'value'));
          const side = (attr(t, 'side') ?? '').toLowerCase().includes('right') ? 'right' : 'left';
          const masked = ['1', 'true', 'yes'].includes((attr(t, 'masked') ?? '').toLowerCase());
          if (v !== null) points.set(`${side}|${hz}|${masked}`, [side, hz, v, masked, 'air', null]);
        }
      }
      if (!Number.isFinite(startMs) || tz === null || points.size === 0) { counts.audiograms.skipped_invalid++; continue; }
      const sourceId = await sourceIdOf(attr(a.line, 'sourceName'));
      const created = await client.query(
        `insert into audiograms (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min)
         select $1, null, $2, $3::timestamptz, $4::timestamptz, $5
         where not exists (
           select 1 from audiograms
           where subject_id = $1 and source_id = $2
             and date_trunc('second', start_ts at time zone 'UTC') = date_trunc('second', $3::timestamptz at time zone 'UTC')
         )
         returning id`,
        [subjectId, sourceId, isoOf(startMs), Number.isFinite(endMs) && endMs >= startMs ? isoOf(endMs) : null, tz]
      );
      if (created.rowCount === 0) { counts.audiograms.deduped++; continue; }
      const params = [created.rows[0].id];
      const tuples = [...points.values()].map((p, j) => {
        params.push(...p);
        const b = 1 + j * 6;
        return `($1, $${b + 1}, $${b + 2}::float8, $${b + 3}::float8, $${b + 4}::boolean, $${b + 5}, $${b + 6})`;
      });
      await client.query(
        `insert into audiogram_points (audiogram_id, side, frequency_hz, sensitivity_db_hl, masked, conduction, clamped)
         values ${tuples.join(',')}`,
        params
      );
      counts.audiograms.inserted++;
      counts.audiograms.points_inserted += points.size;
    }
  }

  // --- routes ----------------------------------------------------------------------------
  const files = await exportFiles(input);
  if (only.has('routes')) {
    const TRKPT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
    const inner = (xml, tag) => {
      const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
      return m ? m[1] : null;
    };
    for (const w of routeRefs) {
      counts.routes.referenced++;
      const startMs = parseTs(w.start);
      if (!Number.isFinite(startMs) || !w.activity) { counts.routes.workout_unmatched++; continue; }
      const candidates = await client.query(
        `select id from workouts
         where subject_id = $1 and activity_type = $2
           and start_ts between $3::timestamptz - interval '1 second' and $3::timestamptz + interval '1 second'
         limit 2`,
        [subjectId, w.activity, isoOf(startMs)]
      );
      if (candidates.rowCount === 0) { counts.routes.workout_unmatched++; continue; }
      if (candidates.rowCount > 1) { counts.routes.workout_ambiguous++; continue; }
      const workoutId = candidates.rows[0].id;
      const path = files.resolve(w.route.path);
      let gpx;
      try {
        if (!path) throw new Error('missing');
        gpx = await files.read(path);
      } catch {
        counts.routes.file_missing++;
        continue;
      }
      counts.routes.workout_matched++;
      const rows = [];
      for (const m of gpx.matchAll(TRKPT)) {
        const lat = num(attr(`<x ${m[1]}`, 'lat'));
        const lon = num(attr(`<x ${m[1]}`, 'lon'));
        const tsMs = Date.parse(inner(m[2], 'time') ?? '');
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(tsMs)) {
          counts.routes.points_skipped++;
          continue;
        }
        const nn = (v) => (v !== null && v >= 0 ? v : null);
        rows.push([isoOf(tsMs), lat, lon, num(inner(m[2], 'ele')), nn(num(inner(m[2], 'speed'))), nn(num(inner(m[2], 'course'))), nn(num(inner(m[2], 'hAcc')))]);
      }
      const CHUNK = 400;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const params = [workoutId];
        const tuples = slice.map((r, j) => {
          params.push(...r);
          const b = 1 + j * 7;
          return `($1, $${b + 1}::timestamptz, $${b + 2}::float8, $${b + 3}::float8, $${b + 4}::float8, $${b + 5}::float8, $${b + 6}::float8, $${b + 7}::float8)`;
        });
        const res = await client.query(
          `insert into workout_route_points (workout_id, ts, lat, lon, altitude_m, speed_ms, course_deg, h_acc_m)
           values ${tuples.join(',')} on conflict (workout_id, ts) do nothing`,
          params
        );
        counts.routes.points_inserted += res.rowCount ?? 0;
        counts.routes.points_duplicate += slice.length - (res.rowCount ?? 0);
      }
    }
  }

  // --- ECG CSV files ---------------------------------------------------------------------
  if (only.has('ecg')) {
    const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const classificationOf = (label) => {
      const l = strip(label);
      if (l.includes('sinus')) return 'sinus_rhythm';
      if (l.includes('fibrillation')) return 'atrial_fibrillation';
      if (l.includes('basse') || l.includes('low')) return 'inconclusive_low_heart_rate';
      if (l.includes('elevee') || l.includes('high')) return 'inconclusive_high_heart_rate';
      if (l.includes('mauvais') || l.includes('poor')) return 'inconclusive_poor_reading';
      if (l.includes('concluant') || l.includes('inconclusive')) return 'inconclusive_other';
      return 'unrecognized';
    };
    const symptomsOf = (label) => {
      const l = strip(label);
      if (l === '' || l.includes('renseign') || l.includes('not set')) return 'not_set';
      if (l.includes('aucun') || l.includes('none')) return 'none';
      return 'present';
    };
    const csvs = (await files.list('electrocardiograms')).filter((p) => p.toLowerCase().endsWith('.csv'));
    console.log(`${csvs.length} ECG file(s)`);
    for (const path of csvs) {
      counts.ecg.files++;
      const text = await files.read(path);
      const all = text.split(/\r?\n/);
      const blank = all.findIndex((l) => l.trim() === '');
      const header = blank < 0 ? all.slice(0, 12) : all.slice(0, blank);
      const values = (blank < 0 ? all.slice(12) : all.slice(blank + 1)).filter((l) => l.trim() !== '');
      const meta = {};
      for (const line of header) {
        const c = line.indexOf(',');
        if (c < 0) continue;
        const key = strip(line.slice(0, c));
        const value = line.slice(c + 1).replace(/^"|"$/g, '').trim();
        if (key.includes('enregistr') || key.includes('recorded')) meta.date = value;
        else if (key.includes('classification')) meta.classification = value;
        else if (key.includes('sympt')) meta.symptoms = value;
        else if (key.includes('logiciel') || key.includes('software')) meta.software = value;
        else if (key.includes('appareil') || key.includes('device')) meta.device = value;
        else if (key.includes('chantillonnage') || key.includes('sample')) meta.sampling = value;
        else if (key.includes('unit')) meta.unit = value;
        // Name and date of birth are neither read nor kept.
      }
      const startMs = parseTs(meta.date);
      const tz = tzOffsetMin(meta.date);
      const hz = num((meta.sampling ?? '').match(/[\d.]+/)?.[0]);
      const toUv = strip(meta.unit ?? 'µv').includes('mv') ? 1000 : 1;
      const voltages = values.map((l) => Math.round(Number(l.trim().replace(',', '.')) * toUv));
      if (!Number.isFinite(startMs) || tz === null || hz === null || hz <= 0 || voltages.length === 0 || voltages.some((v) => !Number.isFinite(v))) {
        counts.ecg.skipped_invalid++;
        continue;
      }
      const sourceId = await sourceIdOf((meta.device ?? '').split(',')[0]);
      const durationMs = (voltages.length / hz) * 1000;
      const algo = num((meta.software ?? '').match(/\d+/)?.[0]);
      const res = await client.query(
        `insert into ecg_recordings
           (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min, classification, symptoms_status,
            avg_hr_bpm, sampling_hz, algorithm_version, lead, n_samples, voltages_uv)
         select $1, null, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, null, $8, $9, $10, $11, $12::smallint[]
         where not exists (
           select 1 from ecg_recordings
           where subject_id = $1 and source_id = $2
             and date_trunc('second', start_ts at time zone 'UTC') = date_trunc('second', $3::timestamptz at time zone 'UTC')
         )`,
        [
          subjectId, sourceId, isoOf(startMs), isoOf(startMs + durationMs), tz,
          classificationOf(meta.classification ?? ''), symptomsOf(meta.symptoms ?? ''),
          hz, algo, 'apple_watch_similar_to_lead_i', voltages.length,
          voltages.map((v) => Math.max(-32767, Math.min(32767, v))),
        ]
      );
      counts.ecg[res.rowCount ? 'inserted' : 'deduped']++;
    }
  }

  await client.query(`update import_runs set finished_at = now(), status = 'done', counts = $2 where id = $1`, [runId, counts]);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(counts)}`);
} catch (err) {
  if (runId !== null) {
    await client.query(
      `update import_runs set finished_at = now(), status = 'failed', counts = $2 where id = $1`,
      [runId, { ...counts, error: String(err?.message ?? err) }]
    ).catch(() => {});
  }
  throw err;
} finally {
  await client.end().catch(() => {});
}
