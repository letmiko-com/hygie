// Normalizer for the native channel (hygie-native/1, docs/native-format.md).
// Simpler than the HAE one by construction: no name mapping (HealthKit
// identifiers on the wire), no unit conversion (the app sends canonical units,
// a mismatch is refused and counted), full-precision timestamps, and an exact
// identity per sample (HealthKit UUID) instead of multiset matching.
//
// What it shares with the HAE normalizer — context, counters, source/unit
// caches, and above all the ENTIRE minute regime (cutover bootstrap, device
// authority, conflict logging) — is imported from normalize-hae.ts, never
// re-implemented: the channel changes, the truth rules do not.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type pg from 'pg';
import {
  BatchValidationError,
  buildNormalizeCtx,
  bump,
  getSourceId,
  getUnitId,
  insertRoutePoints,
  normalizeMinuteRegime,
  quantize,
  resolveRawPath,
  type BatchForNormalize,
  type Ctx,
  type MetricTypeRow,
  type MinutePoint,
  type NormalizeCounts,
  type RoutePointRow,
} from '@/lib/ingest/normalize-hae';
import { hrvMetrics } from '@/lib/hrv';
import { enqueueDirtyRanges, markDirtyHour } from '@/lib/rollups';

export const NATIVE_FORMAT_VERSION = 'hygie-native-v1';

const HK_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

// Bounds of the series sections (native-format.md). A 24 h outdoor workout
// at 1 Hz is 86 400 points; a 30 s ECG at 512 Hz is 15 360 samples.
const MAX_ROUTE_POINTS = 250_000;
const MAX_ECG_SAMPLES = 60_000;
const MAX_AUDIOGRAM_POINTS = 64;
// A day of beats at 60 bpm is 86 400; a watch series is a minute of them.
const MAX_BEAT_INTERVALS = 100_000;
const MAX_MOOD_TOKENS = 64;
const INT16_MAX = 32_767;
// Advisory lock keys of the series sections; metric type ids are positive
// and workouts use 0, so the sections take the negative range.
const LOCK_KEY_WORKOUTS = 0;
const LOCK_KEY_ACTIVITY_SUMMARIES = -1;
const LOCK_KEY_ECGS = -2;
const LOCK_KEY_AUDIOGRAMS = -3;
const LOCK_KEY_HEARTBEAT_SERIES = -4;
const LOCK_KEY_STATE_OF_MIND = -5;
const ECG_SYMPTOMS = new Set(['not_set', 'none', 'present']);
const AUDIOGRAM_SIDES = new Set(['left', 'right']);
const AUDIOGRAM_CLAMPS = new Set(['low', 'high']);
const MOOD_KINDS = new Set(['momentary_emotion', 'daily_mood']);
const TOKEN_RE = /^[a-z0-9_]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Payload shape

export interface NativeSample {
  uuid: string;
  type: string;
  start: string;
  end?: string;
  value?: number;
  unit?: string;
  category?: number;
  source?: string;
}

export interface NativeMinute {
  type: string;
  minute: string;
  value: number;
  unit?: string;
}

export interface NativeWorkout {
  uuid: string;
  activity: string;
  start: string;
  end: string;
  duration_s?: number;
  distance_m?: number;
  energy_kj?: number;
  elevation_up_m?: number;
  indoor?: boolean;
  source?: string;
}

// --- series sections (additive since Hygie Sync 1.1) -------------------------

export interface NativeRoutePoint {
  t: string;
  lat: number;
  lon: number;
  alt?: number;
  speed?: number;
  course?: number;
  hacc?: number;
}

export interface NativeRoute {
  workout_uuid: string;
  uuid?: string;
  source?: string;
  points: NativeRoutePoint[];
}

export interface NativeActivitySummary {
  day: string;
  move_mode?: 'energy' | 'time';
  move_kj?: number;
  move_goal_kj?: number;
  move_time_min?: number;
  move_time_goal_min?: number;
  exercise_min?: number;
  exercise_goal_min?: number;
  stand_h?: number;
  stand_goal_h?: number;
  paused?: boolean;
  source?: string;
}

export interface NativeEcg {
  uuid: string;
  start: string;
  end?: string;
  source?: string;
  classification: string;
  symptoms?: string;
  avg_hr_bpm?: number;
  sampling_hz: number;
  algorithm_version?: number;
  lead?: string;
  voltages_uv: number[];
}

export interface NativeAudiogramPoint {
  hz: number;
  side: 'left' | 'right';
  db_hl: number;
  masked?: boolean;
  conduction?: string;
  clamped?: 'low' | 'high' | null;
}

export interface NativeAudiogram {
  uuid: string;
  start: string;
  end?: string;
  source?: string;
  points: NativeAudiogramPoint[];
}

export interface NativeHeartbeatSeries {
  uuid: string;
  start: string;
  end?: string;
  source?: string;
  /** Delay to the next beat, in ms; null where a gap preceded the beat. */
  intervals_ms: Array<number | null>;
}

export interface NativeStateOfMind {
  uuid: string;
  start: string;
  end?: string;
  source?: string;
  kind: string;
  valence: number;
  valence_classification?: number;
  labels?: string[];
  associations?: string[];
}

const SECTION_KEYS = [
  'samples',
  'minutes',
  'workouts',
  'routes',
  'activity_summaries',
  'ecgs',
  'audiograms',
  'heartbeat_series',
  'state_of_mind',
] as const;

export interface NativePayload {
  format: 'hygie-native/1';
  app_version?: string;
  device?: { name?: string; model?: string; system?: string };
  exported_at?: string;
  samples?: NativeSample[];
  minutes?: NativeMinute[];
  workouts?: NativeWorkout[];
  routes?: NativeRoute[];
  activity_summaries?: NativeActivitySummary[];
  ecgs?: NativeEcg[];
  audiograms?: NativeAudiogram[];
  heartbeat_series?: NativeHeartbeatSeries[];
  state_of_mind?: NativeStateOfMind[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO 8601 with an explicit offset. The offset is the subject-side truth the
// same way it is on every other channel; a bare 'Z' is a valid zero offset.
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;

interface ParsedIso {
  utc: Date;
  tzOffsetMin: number;
}

export function parseIsoDate(raw: string): ParsedIso | null {
  const m = ISO_RE.exec(raw);
  if (!m) return null;
  const utc = new Date(raw);
  if (Number.isNaN(utc.getTime())) return null;
  let tzOffsetMin = 0;
  if (m[1] !== 'Z') {
    const sign = m[1][0] === '-' ? -1 : 1;
    const digits = m[1].replace(':', '').slice(1);
    tzOffsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  if (Math.abs(tzOffsetMin) > 900) return null;
  return { utc, tzOffsetMin };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isNativePayload(v: unknown): v is NativePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.format !== 'hygie-native/1') return false;
  for (const key of SECTION_KEYS) {
    if (p[key] !== undefined && !Array.isArray(p[key])) return false;
  }
  return true;
}

export interface ValidatedNativeBatch {
  payload: NativePayload;
  declaredRange: { min: Date; max: Date } | null;
}

/** Same storage contract as the HAE reader: gzip file, wire checksum, shape. */
export async function readAndValidateNativeBatchFile(
  rawPath: string,
  expectedSha256: Buffer
): Promise<ValidatedNativeBatch> {
  let fileBytes: Buffer;
  try {
    fileBytes = await readFile(resolveRawPath(rawPath));
  } catch {
    throw new BatchValidationError('raw_file_missing', 'raw body file is missing');
  }
  let jsonBytes: Buffer;
  try {
    jsonBytes = gunzipSync(fileBytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new BatchValidationError('gunzip_failed', 'stored body is not valid gzip');
  }
  const shaFile = createHash('sha256').update(fileBytes).digest();
  const shaJson = createHash('sha256').update(jsonBytes).digest();
  if (!shaFile.equals(expectedSha256) && !shaJson.equals(expectedSha256)) {
    throw new BatchValidationError('sha256_mismatch', 'stored body does not match recorded checksum');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBytes.toString('utf8'));
  } catch {
    throw new BatchValidationError('json_invalid', 'body is not valid JSON');
  }
  if (!isNativePayload(parsed)) {
    throw new BatchValidationError('shape_invalid', 'body is not a hygie-native/1 payload');
  }

  let min: Date | null = null;
  let max: Date | null = null;
  const consider = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const p = parseIsoDate(raw);
    if (!p) return;
    if (min === null || p.utc < min) min = p.utc;
    if (max === null || p.utc > max) max = p.utc;
  };
  for (const s of parsed.samples ?? []) consider(s?.start);
  for (const m of parsed.minutes ?? []) consider(m?.minute);
  for (const w of parsed.workouts ?? []) {
    consider(w?.start);
    consider(w?.end);
  }
  for (const r of parsed.routes ?? []) {
    const pts = Array.isArray(r?.points) ? r.points : [];
    consider(pts[0]?.t);
    consider(pts[pts.length - 1]?.t);
  }
  for (const e of parsed.ecgs ?? []) consider(e?.start);
  for (const a of parsed.audiograms ?? []) consider(a?.start);
  for (const h of parsed.heartbeat_series ?? []) {
    consider(h?.start);
    consider(h?.end);
  }
  for (const s of parsed.state_of_mind ?? []) consider(s?.start);
  return {
    payload: parsed,
    declaredRange: min !== null && max !== null ? { min, max } : null,
  };
}

// ---------------------------------------------------------------------------
// Staged rows

interface StagedNative {
  idx: number;
  uuid: string;
  typeId: number;
  hk: string;
  sourceId: number;
  startTs: Date;
  endTs: Date | null;
  tzOffsetMin: number;
  value: number | null;
  valueKey: string | null;
  categoryValue: number | null;
  originalUnitId: number | null;
}

interface StagedSleep {
  uuid: string;
  sourceId: number;
  stage: number;
  startTs: Date;
  endTs: Date;
  tzOffsetMin: number;
}

// ---------------------------------------------------------------------------
// Entry point

export async function normalizeNativePayload(
  client: pg.PoolClient,
  batch: BatchForNormalize,
  payload: NativePayload
): Promise<NormalizeCounts> {
  const ctx = await buildNormalizeCtx(client, batch);
  const { counts, types, optOut } = ctx;

  const samples = payload.samples ?? [];
  const minutes = payload.minutes ?? [];
  const workouts = payload.workouts ?? [];
  const routes = payload.routes ?? [];
  const summaries = payload.activity_summaries ?? [];
  const ecgs = payload.ecgs ?? [];
  const audiograms = payload.audiograms ?? [];
  const heartbeats = payload.heartbeat_series ?? [];
  const moods = payload.state_of_mind ?? [];

  // Advisory locks per (subject, type), plus key 0 for workouts — the same
  // discipline and ordering as the HAE normalizer, so the two channels can
  // never deadlock against each other. Routes write under workouts; the
  // other series sections have their own negative keys.
  const lockKeys = new Set<number>();
  if (workouts.length > 0 || routes.length > 0) lockKeys.add(LOCK_KEY_WORKOUTS);
  if (summaries.length > 0) lockKeys.add(LOCK_KEY_ACTIVITY_SUMMARIES);
  if (ecgs.length > 0) lockKeys.add(LOCK_KEY_ECGS);
  if (audiograms.length > 0) lockKeys.add(LOCK_KEY_AUDIOGRAMS);
  if (heartbeats.length > 0) lockKeys.add(LOCK_KEY_HEARTBEAT_SERIES);
  if (moods.length > 0) lockKeys.add(LOCK_KEY_STATE_OF_MIND);
  for (const s of samples) {
    const t = typeof s?.type === 'string' ? types.get(s.type) : undefined;
    if (t) lockKeys.add(t.id);
  }
  for (const m of minutes) {
    const t = typeof m?.type === 'string' ? types.get(m.type) : undefined;
    if (t) lockKeys.add(t.id);
  }
  for (const key of [...lockKeys].sort((a, b) => a - b)) {
    await client.query('select pg_advisory_xact_lock(hashtext($1), $2)', [
      batch.subject_id,
      key,
    ]);
  }

  // Category contracts for the types this batch carries.
  const categoryValues = new Map<number, Set<number>>();
  {
    const catTypeIds = [
      ...new Set(
        samples
          .map((s) => (typeof s?.type === 'string' ? types.get(s.type) : undefined))
          .filter((t): t is MetricTypeRow => t !== undefined && t.kind === 'category')
          .map((t) => t.id)
      ),
    ];
    if (catTypeIds.length > 0) {
      const { rows } = await client.query<{ type_id: number; raw_value: number }>(
        'select type_id, raw_value from metric_category_values where type_id = any($1::smallint[])',
        [catTypeIds]
      );
      for (const r of rows) {
        const set = categoryValues.get(r.type_id) ?? new Set<number>();
        set.add(r.raw_value);
        categoryValues.set(r.type_id, set);
      }
    }
  }

  // --- classify samples ------------------------------------------------------
  const staged: StagedNative[] = [];
  const sleep: StagedSleep[] = [];
  let idx = 0;

  for (const s of samples) {
    const name = typeof s?.type === 'string' ? s.type : 'unknown';
    const type = typeof s?.type === 'string' ? types.get(s.type) : undefined;
    if (!type) {
      bump(counts, name, 'skipped_unknown_type');
      continue;
    }
    if (!type.supported) {
      bump(counts, name, 'skipped_unsupported');
      continue;
    }
    if (optOut.has(type.id)) {
      bump(counts, name, 'skipped_opt_out');
      continue;
    }
    if (typeof s.uuid !== 'string' || !UUID_RE.test(s.uuid)) {
      bump(counts, name, 'skipped_bad_uuid');
      continue;
    }
    const start = typeof s.start === 'string' ? parseIsoDate(s.start) : null;
    if (!start) {
      bump(counts, name, 'skipped_bad_point');
      continue;
    }
    const end = typeof s.end === 'string' ? parseIsoDate(s.end) : null;

    if (type.kind === 'category') {
      if (!isFiniteNumber(s.category) || !Number.isInteger(s.category)) {
        bump(counts, name, 'skipped_bad_point');
        continue;
      }
      if (type.hk_identifier === HK_SLEEP) {
        // Raw stages, same table as the XML backfill. An end is required:
        // a stage without a duration means nothing.
        if (!end || end.utc <= start.utc) {
          bump(counts, name, 'skipped_bad_point');
          continue;
        }
        if (!categoryValues.get(type.id)?.has(s.category)) {
          bump(counts, name, 'category_without_contract');
          continue;
        }
        sleep.push({
          uuid: s.uuid,
          sourceId: await getSourceId(ctx, s.source),
          stage: s.category,
          startTs: start.utc,
          endTs: end.utc,
          tzOffsetMin: start.tzOffsetMin,
        });
        continue;
      }
      if (!categoryValues.get(type.id)?.has(s.category)) {
        bump(counts, name, 'category_without_contract');
        continue;
      }
      staged.push({
        idx: idx++,
        uuid: s.uuid,
        typeId: type.id,
        hk: type.hk_identifier,
        sourceId: await getSourceId(ctx, s.source),
        startTs: start.utc,
        endTs: end && end.utc >= start.utc ? end.utc : null,
        tzOffsetMin: start.tzOffsetMin,
        value: null,
        valueKey: null,
        categoryValue: s.category,
        originalUnitId: null,
      });
      continue;
    }

    // Quantity. Minute-regime types must arrive through `minutes`: a raw
    // sample here would double the post-cutover truth.
    if (type.hae_regime === 'minute_cumulative') {
      bump(counts, name, 'skipped_minute_type');
      continue;
    }
    if (!isFiniteNumber(s.value)) {
      bump(counts, name, 'skipped_bad_point');
      continue;
    }
    // Canonical units are the app's job (generated from the taxonomy); the
    // server verifies and refuses, it never converts silently.
    if (type.canonical_unit !== null && s.unit !== type.canonical_unit) {
      bump(counts, name, 'unit_mismatch');
      continue;
    }
    // HealthKit hands percentages out as fractions (0.97 for 97 %) while the
    // canonical percent, like Apple's XML export and every HAE row, is 0-100
    // (checked on real data, 2026-09-04). Scaled here until hygie-native/2
    // has the app send percents (docs/native-format.md).
    const value = type.canonical_unit === '%' ? s.value * 100 : s.value;
    staged.push({
      idx: idx++,
      uuid: s.uuid,
      typeId: type.id,
      hk: type.hk_identifier,
      sourceId: await getSourceId(ctx, s.source),
      startTs: start.utc,
      endTs: end && end.utc >= start.utc ? end.utc : null,
      tzOffsetMin: start.tzOffsetMin,
      value,
      valueKey: quantize(value, type.quantize_scale),
      categoryValue: null,
      originalUnitId: s.unit ? await getUnitId(ctx, s.unit) : null,
    });
  }

  await insertObservations(ctx, staged);
  await insertSleepSegments(ctx, sleep);

  // --- minutes: the HAE minute path, verbatim --------------------------------
  const minuteSourceId = await getSourceId(ctx, payload.device?.name ?? 'HealthKit');
  const minutePoints: MinutePoint[] = [];
  for (const m of minutes) {
    const name = typeof m?.type === 'string' ? m.type : 'unknown';
    const type = typeof m?.type === 'string' ? types.get(m.type) : undefined;
    if (!type || type.hae_regime !== 'minute_cumulative') {
      bump(counts, name, 'skipped_not_minute_type');
      continue;
    }
    if (optOut.has(type.id)) {
      bump(counts, name, 'skipped_opt_out');
      continue;
    }
    const parsed = typeof m.minute === 'string' ? parseIsoDate(m.minute) : null;
    if (!parsed || !isFiniteNumber(m.value)) {
      bump(counts, name, 'skipped_bad_point');
      continue;
    }
    if (type.canonical_unit !== null && m.unit !== undefined && m.unit !== type.canonical_unit) {
      bump(counts, name, 'unit_mismatch');
      continue;
    }
    minutePoints.push({
      haeName: type.hk_identifier,
      typeId: type.id,
      sourceId: minuteSourceId,
      minuteTs: new Date(Math.floor(parsed.utc.getTime() / 60_000) * 60_000),
      value: m.value,
    });
  }
  await normalizeMinuteRegime(ctx, minutePoints);

  for (const w of workouts) {
    await normalizeNativeWorkout(ctx, w);
  }
  // Routes after workouts: a route names its workout by HealthKit uuid and
  // the same payload usually carries both.
  for (const r of routes) {
    await normalizeNativeRoute(ctx, r);
  }
  for (const a of summaries) {
    await upsertActivitySummary(ctx, a, payload.device?.name);
  }
  for (const e of ecgs) {
    await insertEcg(ctx, e);
  }
  for (const a of audiograms) {
    await insertAudiogram(ctx, a);
  }
  for (const h of heartbeats) {
    await insertHeartbeatSeries(ctx, h);
  }
  for (const s of moods) {
    await insertStateOfMind(ctx, s);
  }

  const queued = await enqueueDirtyRanges(
    client,
    batch.subject_id,
    batch.id,
    ctx.dirtyHours,
    ctx.dirtyRanges
  );
  if (queued > 0) counts.dirty_ranges = queued;

  return counts;
}

// ---------------------------------------------------------------------------
// Observations: stage, dedup by uuid then exact, insert

async function insertObservations(ctx: Ctx, staged: StagedNative[]): Promise<void> {
  if (staged.length === 0) return;
  const nameOfIdx = new Map<number, string>();
  for (const r of staged) nameOfIdx.set(r.idx, r.hk);
  const nameOfTypeId = new Map<number, string>();
  for (const r of staged) nameOfTypeId.set(r.typeId, r.hk);

  // `on commit drop` covers the production shape (one batch per transaction);
  // the explicit drop covers harnesses that replay several batches in one.
  await ctx.client.query('drop table if exists staging_native');
  await ctx.client.query(
    `create temp table staging_native (
       idx integer primary key,
       uuid uuid not null,
       type_id smallint not null,
       source_id smallint not null,
       start_ts timestamptz not null,
       end_ts timestamptz,
       tz_offset_min smallint not null,
       value double precision,
       value_key bigint,
       category_value smallint,
       original_unit_id smallint
     ) on commit drop`
  );
  const CHUNK = 500;
  for (let i = 0; i < staged.length; i += CHUNK) {
    const slice = staged.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = slice.map((r, j) => {
      params.push(
        r.idx, r.uuid, r.typeId, r.sourceId, r.startTs, r.endTs,
        r.tzOffsetMin, r.value, r.valueKey, r.categoryValue, r.originalUnitId
      );
      const b = j * 11;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
    });
    await ctx.client.query(
      `insert into staging_native
         (idx, uuid, type_id, source_id, start_ts, end_ts, tz_offset_min,
          value, value_key, category_value, original_unit_id)
       values ${tuples.join(',')}`,
      params
    );
  }

  // Intra-batch dedup by uuid (an anchored query replayed within one batch).
  const dupBatch = await ctx.client.query<{ type_id: number }>(
    `delete from staging_native a using staging_native b
     where a.uuid = b.uuid and a.idx > b.idx
     returning a.type_id`
  );
  for (const r of dupBatch.rows) {
    bump(ctx.counts, nameOfTypeId.get(r.type_id) ?? String(r.type_id), 'deduped_batch');
  }

  // Dedup 1 (native-format.md): the HealthKit UUID is the sample's identity.
  const dupUuid = await ctx.client.query<{ type_id: number }>(
    `delete from staging_native s using observations o
     where o.subject_id = $1 and o.hk_uuid = s.uuid
     returning s.type_id`,
    [ctx.batch.subject_id]
  );
  for (const r of dupUuid.rows) {
    bump(ctx.counts, nameOfTypeId.get(r.type_id) ?? String(r.type_id), 'deduped_uuid');
  }

  // Dedup 2: exact residual against uuid-less history (XML backfill, old HAE
  // rows). No ±1s window here by design — see native-format.md.
  const dupExact = await ctx.client.query<{ type_id: number }>(
    `delete from staging_native s using observations o
     where o.subject_id = $1 and o.hk_uuid is null
       and o.type_id = s.type_id and o.source_id = s.source_id
       and o.start_ts = s.start_ts
       and o.value_key is not distinct from s.value_key
       and o.category_value is not distinct from s.category_value
     returning s.type_id`,
    [ctx.batch.subject_id]
  );
  for (const r of dupExact.rows) {
    bump(ctx.counts, nameOfTypeId.get(r.type_id) ?? String(r.type_id), 'deduped_exact');
  }

  const inserted = await ctx.client.query<{ type_id: number; start_ts: Date; category_value: number | null }>(
    `insert into observations
       (subject_id, type_id, source_id, start_ts, end_ts, value, value_key,
        category_value, tz_offset_min, origin, original_unit_id, ingest_batch_id, hk_uuid)
     select $1, type_id, source_id, start_ts, end_ts, value, value_key,
            category_value, tz_offset_min, 'hae', original_unit_id, $2, uuid
     from staging_native
     returning type_id, start_ts, category_value`,
    [ctx.batch.subject_id, ctx.batch.id]
  );
  for (const r of inserted.rows) {
    bump(ctx.counts, nameOfTypeId.get(r.type_id) ?? String(r.type_id), 'inserted');
    // Categories carry no rollup (aggregation 'none'): nothing to invalidate.
    if (r.category_value === null) markDirtyHour(ctx.dirtyHours, r.type_id, r.start_ts);
  }
}

// ---------------------------------------------------------------------------
// Sleep segments: raw stages with a uuid identity

async function insertSleepSegments(ctx: Ctx, segments: StagedSleep[]): Promise<void> {
  if (segments.length === 0) return;
  const name = HK_SLEEP;

  // Intra-batch dedup by uuid, last occurrence wins.
  const byUuid = new Map<string, StagedSleep>();
  let dupBatch = 0;
  for (const s of segments) {
    if (byUuid.has(s.uuid)) dupBatch++;
    byUuid.set(s.uuid, s);
  }
  bump(ctx.counts, name, 'deduped_batch', dupBatch);

  for (const s of byUuid.values()) {
    // uuid identity first, then the exact uuid-less residual (XML history).
    const res = await ctx.client.query(
      `insert into sleep_segments
         (subject_id, source_id, stage, start_ts, end_ts, tz_offset_min, hk_uuid)
       select $1, $2, $3, $4, $5, $6, $7
       where not exists (
         select 1 from sleep_segments
         where subject_id = $1 and hk_uuid = $7
       ) and not exists (
         select 1 from sleep_segments
         where subject_id = $1 and hk_uuid is null
           and source_id = $2 and stage = $3 and start_ts = $4 and end_ts = $5
       )`,
      [ctx.batch.subject_id, s.sourceId, s.stage, s.startTs, s.endTs, s.tzOffsetMin, s.uuid]
    );
    bump(ctx.counts, name, res.rowCount ? 'segment_inserted' : 'segment_deduped');
  }
}

// ---------------------------------------------------------------------------
// Workouts: HealthKit uuid identity under namespace 'healthkit'

async function normalizeNativeWorkout(ctx: Ctx, w: NativeWorkout): Promise<void> {
  const wc = (ctx.counts.workouts ??= {});
  wc.received = (wc.received ?? 0) + 1;

  const start = typeof w?.start === 'string' ? parseIsoDate(w.start) : null;
  const end = typeof w?.end === 'string' ? parseIsoDate(w.end) : null;
  if (
    !start || !end ||
    typeof w.uuid !== 'string' || !UUID_RE.test(w.uuid) ||
    typeof w.activity !== 'string' || !(end.utc > start.utc)
  ) {
    wc.skipped_invalid = (wc.skipped_invalid ?? 0) + 1;
    return;
  }
  const sourceId = await getSourceId(ctx, w.source);

  // Same identity discipline as the HAE channel (normalize-hae.ts): lookup
  // scoped to the device's subject, foreign collisions counted never adopted,
  // then a single unambiguous fingerprint match, then insert.
  const known = await ctx.client.query<{ workout_id: string }>(
    `select e.workout_id from workout_external_ids e
     join workouts wk on wk.id = e.workout_id
     where e.namespace = 'healthkit' and e.external_id = $1 and wk.subject_id = $2`,
    [w.uuid, ctx.batch.subject_id]
  );
  if (known.rows.length > 0) {
    wc.already_known = (wc.already_known ?? 0) + 1;
    return;
  }
  const foreign = await ctx.client.query(
    `select 1 from workout_external_ids e
     join workouts wk on wk.id = e.workout_id
     where e.namespace = 'healthkit' and e.external_id = $1 and wk.subject_id <> $2
     limit 1`,
    [w.uuid, ctx.batch.subject_id]
  );
  if ((foreign.rowCount ?? 0) > 0) {
    wc.external_id_other_subject = (wc.external_id_other_subject ?? 0) + 1;
  }

  const candidates = await ctx.client.query<{ id: string }>(
    `select wk.id from workouts wk
     where wk.subject_id = $1 and wk.activity_type = $2
       and wk.start_ts between $3::timestamptz - interval '1 second'
                           and $3::timestamptz + interval '1 second'
       and not exists (
         select 1 from workout_external_ids e
         where e.workout_id = wk.id and e.namespace = 'healthkit'
       )
     limit 2`,
    [ctx.batch.subject_id, w.activity, start.utc]
  );
  let workoutId: string;
  if (candidates.rows.length === 1) {
    workoutId = candidates.rows[0].id;
    wc.matched_fingerprint = (wc.matched_fingerprint ?? 0) + 1;
  } else {
    if (candidates.rows.length > 1) {
      wc.ambiguous_fingerprint = (wc.ambiguous_fingerprint ?? 0) + 1;
    }
    const created = await ctx.client.query<{ id: string }>(
      `insert into workouts
         (subject_id, activity_type, source_id, start_ts, end_ts, tz_offset_min,
          is_indoor, duration_s, distance_m, energy_kj, elevation_up_m, stats)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        ctx.batch.subject_id,
        w.activity,
        sourceId,
        start.utc,
        end.utc,
        start.tzOffsetMin,
        typeof w.indoor === 'boolean' ? w.indoor : null,
        isFiniteNumber(w.duration_s) ? w.duration_s : (end.utc.getTime() - start.utc.getTime()) / 1000,
        isFiniteNumber(w.distance_m) ? w.distance_m : null,
        isFiniteNumber(w.energy_kj) ? w.energy_kj : null,
        isFiniteNumber(w.elevation_up_m) ? w.elevation_up_m : null,
        JSON.stringify({ channel: 'native' }),
      ]
    );
    workoutId = created.rows[0].id;
    wc.created = (wc.created ?? 0) + 1;
  }
  await ctx.client.query(
    `insert into workout_external_ids (workout_id, namespace, external_id)
     values ($1, 'healthkit', $2)
     on conflict do nothing`,
    [workoutId, w.uuid]
  );
}

// ---------------------------------------------------------------------------
// Routes: GPS points of a workout already known under namespace 'healthkit'

async function normalizeNativeRoute(ctx: Ctx, r: NativeRoute): Promise<void> {
  const rc = (ctx.counts.routes ??= {});
  rc.received = (rc.received ?? 0) + 1;

  if (typeof r?.workout_uuid !== 'string' || !UUID_RE.test(r.workout_uuid) || !Array.isArray(r.points)) {
    rc.skipped_invalid = (rc.skipped_invalid ?? 0) + 1;
    return;
  }
  if (r.points.length > MAX_ROUTE_POINTS) {
    rc.skipped_too_large = (rc.skipped_too_large ?? 0) + 1;
    return;
  }
  // Scoped to the device's subject: a uuid known under another subject is a
  // foreign route, counted and never adopted.
  const known = await ctx.client.query<{ workout_id: string }>(
    `select e.workout_id from workout_external_ids e
     join workouts wk on wk.id = e.workout_id
     where e.namespace = 'healthkit' and e.external_id = $1 and wk.subject_id = $2`,
    [r.workout_uuid, ctx.batch.subject_id]
  );
  if (known.rows.length === 0) {
    rc.workout_unknown = (rc.workout_unknown ?? 0) + 1;
    return;
  }
  const workoutId = known.rows[0].workout_id;

  const rows: RoutePointRow[] = [];
  for (const p of r.points) {
    const ts = typeof p?.t === 'string' ? parseIsoDate(p.t) : null;
    if (
      !ts ||
      !isFiniteNumber(p.lat) || Math.abs(p.lat) > 90 ||
      !isFiniteNumber(p.lon) || Math.abs(p.lon) > 180
    ) {
      rc.points_skipped = (rc.points_skipped ?? 0) + 1;
      continue;
    }
    rows.push([
      ts.utc,
      p.lat,
      p.lon,
      isFiniteNumber(p.alt) ? p.alt : null,
      isFiniteNumber(p.speed) && p.speed >= 0 ? p.speed : null,
      isFiniteNumber(p.course) && p.course >= 0 ? p.course : null,
      isFiniteNumber(p.hacc) && p.hacc >= 0 ? p.hacc : null,
    ]);
  }
  const res = await insertRoutePoints(ctx.client, workoutId, rows);
  rc.points_inserted = (rc.points_inserted ?? 0) + res.inserted;
  rc.points_duplicate = (rc.points_duplicate ?? 0) + res.duplicate;
  rc[res.inserted > 0 ? 'inserted' : 'deduped'] = (rc[res.inserted > 0 ? 'inserted' : 'deduped'] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Activity rings: one row per day, upsert that only registers real changes

function nonNegative(v: unknown): number | null {
  return isFiniteNumber(v) && v >= 0 ? v : null;
}

async function upsertActivitySummary(
  ctx: Ctx,
  a: NativeActivitySummary,
  deviceName: string | undefined
): Promise<void> {
  const ac = (ctx.counts.activity_summaries ??= {});
  ac.received = (ac.received ?? 0) + 1;

  if (typeof a?.day !== 'string' || !DAY_RE.test(a.day) || Number.isNaN(Date.parse(`${a.day}T00:00:00Z`))) {
    ac.skipped_invalid = (ac.skipped_invalid ?? 0) + 1;
    return;
  }
  const moveMode = a.move_mode === 'time' ? 'time' : 'energy';
  const sourceId = await getSourceId(ctx, a.source ?? deviceName ?? 'HealthKit');
  const values = [
    ctx.batch.subject_id,
    a.day,
    moveMode,
    nonNegative(a.move_kj),
    nonNegative(a.move_goal_kj),
    nonNegative(a.move_time_min),
    nonNegative(a.move_time_goal_min),
    nonNegative(a.exercise_min),
    nonNegative(a.exercise_goal_min),
    nonNegative(a.stand_h),
    nonNegative(a.stand_goal_h),
    a.paused === true,
    sourceId,
    ctx.batch.id,
  ];
  // `xmax = 0` marks a fresh insert; a conflict whose WHERE is false returns
  // nothing, which is the "unchanged" outcome.
  const res = await ctx.client.query<{ inserted: boolean }>(
    `insert into activity_summaries
       (subject_id, day, move_mode, move_kj, move_goal_kj, move_time_min, move_time_goal_min,
        exercise_min, exercise_goal_min, stand_h, stand_goal_h, paused, source_id, ingest_batch_id)
     values ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (subject_id, day) do update set
       move_mode = excluded.move_mode,
       move_kj = excluded.move_kj,
       move_goal_kj = excluded.move_goal_kj,
       move_time_min = excluded.move_time_min,
       move_time_goal_min = excluded.move_time_goal_min,
       exercise_min = excluded.exercise_min,
       exercise_goal_min = excluded.exercise_goal_min,
       stand_h = excluded.stand_h,
       stand_goal_h = excluded.stand_goal_h,
       paused = excluded.paused,
       source_id = excluded.source_id,
       ingest_batch_id = excluded.ingest_batch_id,
       updated_at = now()
     where (activity_summaries.move_mode, activity_summaries.move_kj, activity_summaries.move_goal_kj,
            activity_summaries.move_time_min, activity_summaries.move_time_goal_min,
            activity_summaries.exercise_min, activity_summaries.exercise_goal_min,
            activity_summaries.stand_h, activity_summaries.stand_goal_h, activity_summaries.paused)
           is distinct from
           (excluded.move_mode, excluded.move_kj, excluded.move_goal_kj,
            excluded.move_time_min, excluded.move_time_goal_min,
            excluded.exercise_min, excluded.exercise_goal_min,
            excluded.stand_h, excluded.stand_goal_h, excluded.paused)
     returning (xmax = 0) as inserted`,
    values
  );
  const row = res.rows[0];
  const key = row === undefined ? 'unchanged' : row.inserted ? 'inserted' : 'updated';
  ac[key] = (ac[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// ECG recordings: uuid identity, then the per-second residual

async function insertEcg(ctx: Ctx, e: NativeEcg): Promise<void> {
  const ec = (ctx.counts.ecgs ??= {});
  ec.received = (ec.received ?? 0) + 1;

  const start = typeof e?.start === 'string' ? parseIsoDate(e.start) : null;
  const end = typeof e?.end === 'string' ? parseIsoDate(e.end) : null;
  if (
    !start ||
    typeof e.uuid !== 'string' || !UUID_RE.test(e.uuid) ||
    typeof e.classification !== 'string' || !TOKEN_RE.test(e.classification) ||
    !isFiniteNumber(e.sampling_hz) || e.sampling_hz <= 0 ||
    !Array.isArray(e.voltages_uv) || e.voltages_uv.length === 0
  ) {
    ec.skipped_invalid = (ec.skipped_invalid ?? 0) + 1;
    return;
  }
  if (e.voltages_uv.length > MAX_ECG_SAMPLES) {
    ec.skipped_too_large = (ec.skipped_too_large ?? 0) + 1;
    return;
  }
  const voltages: number[] = new Array(e.voltages_uv.length);
  for (let i = 0; i < e.voltages_uv.length; i++) {
    const v = e.voltages_uv[i];
    if (!isFiniteNumber(v)) {
      ec.skipped_invalid = (ec.skipped_invalid ?? 0) + 1;
      return;
    }
    voltages[i] = Math.max(-INT16_MAX, Math.min(INT16_MAX, Math.round(v)));
  }
  const symptoms = typeof e.symptoms === 'string' && ECG_SYMPTOMS.has(e.symptoms) ? e.symptoms : 'not_set';
  const lead = typeof e.lead === 'string' && TOKEN_RE.test(e.lead) ? e.lead : 'apple_watch_similar_to_lead_i';
  const sourceId = await getSourceId(ctx, e.source);
  const res = await ctx.client.query(
    `insert into ecg_recordings
       (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min, classification,
        symptoms_status, avg_hr_bpm, sampling_hz, algorithm_version, lead, n_samples,
        voltages_uv, ingest_batch_id)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::smallint[], $15
     where not exists (
       select 1 from ecg_recordings where subject_id = $1 and hk_uuid = $2
     ) and not exists (
       -- Same subject, same second: the same recording, whatever name the
       -- channel gave the watch (CSV import says "Watch7,1", HealthKit says
       -- the user's watch name). One person cannot start two ECGs in one second.
       select 1 from ecg_recordings
       where subject_id = $1
         and date_trunc('second', start_ts at time zone 'UTC')
             = date_trunc('second', $4::timestamptz at time zone 'UTC')
     )`,
    [
      ctx.batch.subject_id,
      e.uuid,
      sourceId,
      start.utc,
      end && end.utc >= start.utc ? end.utc : null,
      start.tzOffsetMin,
      e.classification,
      symptoms,
      isFiniteNumber(e.avg_hr_bpm) && e.avg_hr_bpm > 0 ? e.avg_hr_bpm : null,
      e.sampling_hz,
      isFiniteNumber(e.algorithm_version) && Number.isInteger(e.algorithm_version) ? e.algorithm_version : null,
      lead,
      voltages.length,
      voltages,
      ctx.batch.id,
    ]
  );
  ec[res.rowCount ? 'inserted' : 'deduped'] = (ec[res.rowCount ? 'inserted' : 'deduped'] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Audiograms: same identity discipline, points in a child table

async function insertAudiogram(ctx: Ctx, a: NativeAudiogram): Promise<void> {
  const ac = (ctx.counts.audiograms ??= {});
  ac.received = (ac.received ?? 0) + 1;

  const start = typeof a?.start === 'string' ? parseIsoDate(a.start) : null;
  const end = typeof a?.end === 'string' ? parseIsoDate(a.end) : null;
  if (
    !start ||
    typeof a.uuid !== 'string' || !UUID_RE.test(a.uuid) ||
    !Array.isArray(a.points) || a.points.length === 0 || a.points.length > MAX_AUDIOGRAM_POINTS
  ) {
    ac.skipped_invalid = (ac.skipped_invalid ?? 0) + 1;
    return;
  }
  type Point = [string, number, number, boolean, string, string | null];
  const points = new Map<string, Point>();
  for (const p of a.points) {
    if (
      typeof p?.side !== 'string' || !AUDIOGRAM_SIDES.has(p.side) ||
      !isFiniteNumber(p.hz) || p.hz <= 0 ||
      !isFiniteNumber(p.db_hl)
    ) {
      ac.points_skipped = (ac.points_skipped ?? 0) + 1;
      continue;
    }
    const masked = p.masked === true;
    const conduction = typeof p.conduction === 'string' && TOKEN_RE.test(p.conduction) ? p.conduction : 'air';
    const clamped = typeof p.clamped === 'string' && AUDIOGRAM_CLAMPS.has(p.clamped) ? p.clamped : null;
    // Same primary key as the table: the last occurrence wins.
    points.set(`${p.side}|${p.hz}|${masked}`, [p.side, p.hz, p.db_hl, masked, conduction, clamped]);
  }
  if (points.size === 0) {
    ac.skipped_invalid = (ac.skipped_invalid ?? 0) + 1;
    return;
  }
  const sourceId = await getSourceId(ctx, a.source);
  const created = await ctx.client.query<{ id: string }>(
    `insert into audiograms
       (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min, ingest_batch_id)
     select $1, $2, $3, $4, $5, $6, $7
     where not exists (
       select 1 from audiograms where subject_id = $1 and hk_uuid = $2
     ) and not exists (
       select 1 from audiograms
       where subject_id = $1
         and date_trunc('second', start_ts at time zone 'UTC')
             = date_trunc('second', $4::timestamptz at time zone 'UTC')
     )
     returning id`,
    [
      ctx.batch.subject_id,
      a.uuid,
      sourceId,
      start.utc,
      end && end.utc >= start.utc ? end.utc : null,
      start.tzOffsetMin,
      ctx.batch.id,
    ]
  );
  const row = created.rows[0];
  if (!row) {
    ac.deduped = (ac.deduped ?? 0) + 1;
    return;
  }
  const params: unknown[] = [row.id];
  const tuples = [...points.values()].map((p, j) => {
    params.push(...p);
    const b = 1 + j * 6;
    return `($1, $${b + 1}, $${b + 2}::float8, $${b + 3}::float8, $${b + 4}::boolean, $${b + 5}, $${b + 6})`;
  });
  await ctx.client.query(
    `insert into audiogram_points
       (audiogram_id, side, frequency_hz, sensitivity_db_hl, masked, conduction, clamped)
     values ${tuples.join(',')}`,
    params
  );
  ac.inserted = (ac.inserted ?? 0) + 1;
  ac.points_inserted = (ac.points_inserted ?? 0) + points.size;
}

// ---------------------------------------------------------------------------
// Heartbeat series: uuid identity, then the per-second residual. The derived
// HRV metrics are computed here, once, so that aggregating a period never
// re-reads the interval arrays (src/lib/hrv.ts holds the rules).

async function insertHeartbeatSeries(ctx: Ctx, h: NativeHeartbeatSeries): Promise<void> {
  const hc = (ctx.counts.heartbeat_series ??= {});
  hc.received = (hc.received ?? 0) + 1;

  const start = typeof h?.start === 'string' ? parseIsoDate(h.start) : null;
  const end = typeof h?.end === 'string' ? parseIsoDate(h.end) : null;
  if (
    !start ||
    typeof h.uuid !== 'string' || !UUID_RE.test(h.uuid) ||
    !Array.isArray(h.intervals_ms)
  ) {
    hc.skipped_invalid = (hc.skipped_invalid ?? 0) + 1;
    return;
  }
  if (h.intervals_ms.length > MAX_BEAT_INTERVALS) {
    hc.skipped_too_large = (hc.skipped_too_large ?? 0) + 1;
    return;
  }
  // A delay above the smallint ceiling is a gap by any physiological
  // reading; it is stored as one rather than clamped to a fake interval.
  const intervals: Array<number | null> = new Array(h.intervals_ms.length);
  for (let i = 0; i < h.intervals_ms.length; i++) {
    const v = h.intervals_ms[i];
    intervals[i] =
      isFiniteNumber(v) && v > 0 && v <= INT16_MAX ? Math.round(v) : null;
  }
  const metrics = hrvMetrics(intervals);
  // Beats, not intervals: a series of n beats carries n-1 delays.
  const beatCount = intervals.length === 0 ? 0 : intervals.length + 1;
  const durationS =
    end && end.utc >= start.utc ? (end.utc.getTime() - start.utc.getTime()) / 1000 : null;
  const sourceId = await getSourceId(ctx, h.source);
  const res = await ctx.client.query(
    `insert into heartbeat_series
       (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min, beat_count,
        gap_count, duration_s, intervals_ms, mean_rr_ms, mean_hr_bpm, sdnn_ms,
        rmssd_ms, pnn50_pct, ingest_batch_id)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[], $11, $12, $13, $14, $15, $16
     where not exists (
       select 1 from heartbeat_series where subject_id = $1 and hk_uuid = $2
     ) and not exists (
       -- Same subject, same second: the same series whatever name the
       -- channel gave the watch. Two series cannot start in the same second.
       select 1 from heartbeat_series
       where subject_id = $1
         and date_trunc('second', start_ts at time zone 'UTC')
             = date_trunc('second', $4::timestamptz at time zone 'UTC')
     )`,
    [
      ctx.batch.subject_id,
      h.uuid,
      sourceId,
      start.utc,
      end && end.utc >= start.utc ? end.utc : null,
      start.tzOffsetMin,
      beatCount,
      metrics.gapCount,
      durationS,
      intervals,
      metrics.meanRrMs,
      metrics.meanHrBpm,
      metrics.sdnnMs,
      metrics.rmssdMs,
      metrics.pnn50Pct,
      ctx.batch.id,
    ]
  );
  const key = res.rowCount ? 'inserted' : 'deduped';
  hc[key] = (hc[key] ?? 0) + 1;
  if (res.rowCount) hc.beats = (hc.beats ?? 0) + beatCount;
}

// ---------------------------------------------------------------------------
// State of mind: uuid identity, then (kind, second) — the two kinds can
// legitimately share a timestamp, so the residual carries the kind.

function moodTokens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && TOKEN_RE.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_MOOD_TOKENS) break;
  }
  return out;
}

async function insertStateOfMind(ctx: Ctx, s: NativeStateOfMind): Promise<void> {
  const sc = (ctx.counts.state_of_mind ??= {});
  sc.received = (sc.received ?? 0) + 1;

  const start = typeof s?.start === 'string' ? parseIsoDate(s.start) : null;
  const end = typeof s?.end === 'string' ? parseIsoDate(s.end) : null;
  if (
    !start ||
    typeof s.uuid !== 'string' || !UUID_RE.test(s.uuid) ||
    typeof s.kind !== 'string' || !MOOD_KINDS.has(s.kind) ||
    !isFiniteNumber(s.valence) || s.valence < -1 || s.valence > 1
  ) {
    sc.skipped_invalid = (sc.skipped_invalid ?? 0) + 1;
    return;
  }
  const classification =
    isFiniteNumber(s.valence_classification) &&
    Number.isInteger(s.valence_classification) &&
    s.valence_classification >= 1 &&
    s.valence_classification <= 7
      ? s.valence_classification
      : null;
  const sourceId = await getSourceId(ctx, s.source);
  const res = await ctx.client.query(
    `insert into state_of_mind
       (subject_id, hk_uuid, source_id, start_ts, end_ts, tz_offset_min, kind,
        valence, valence_classification, labels, associations, ingest_batch_id)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::text[], $12
     where not exists (
       select 1 from state_of_mind where subject_id = $1 and hk_uuid = $2
     ) and not exists (
       select 1 from state_of_mind
       where subject_id = $1 and kind = $7
         and date_trunc('second', start_ts at time zone 'UTC')
             = date_trunc('second', $4::timestamptz at time zone 'UTC')
     )`,
    [
      ctx.batch.subject_id,
      s.uuid,
      sourceId,
      start.utc,
      end && end.utc >= start.utc ? end.utc : null,
      start.tzOffsetMin,
      s.kind,
      s.valence,
      classification,
      moodTokens(s.labels),
      moodTokens(s.associations),
      ctx.batch.id,
    ]
  );
  const key = res.rowCount ? 'inserted' : 'deduped';
  sc[key] = (sc[key] ?? 0) + 1;
}
