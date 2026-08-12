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
  normalizeMinuteRegime,
  quantize,
  resolveRawPath,
  type BatchForNormalize,
  type Ctx,
  type MetricTypeRow,
  type MinutePoint,
  type NormalizeCounts,
} from '@/lib/ingest/normalize-hae';
import { enqueueDirtyRanges, markDirtyHour } from '@/lib/rollups';

export const NATIVE_FORMAT_VERSION = 'hygie-native-v1';

const HK_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

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

export interface NativePayload {
  format: 'hygie-native/1';
  app_version?: string;
  device?: { name?: string; model?: string; system?: string };
  exported_at?: string;
  samples?: NativeSample[];
  minutes?: NativeMinute[];
  workouts?: NativeWorkout[];
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
  for (const key of ['samples', 'minutes', 'workouts'] as const) {
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

  // Advisory locks per (subject, type), plus key 0 for workouts — the same
  // discipline and ordering as the HAE normalizer, so the two channels can
  // never deadlock against each other.
  const lockKeys = new Set<number>();
  if (workouts.length > 0) lockKeys.add(0);
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
    staged.push({
      idx: idx++,
      uuid: s.uuid,
      typeId: type.id,
      hk: type.hk_identifier,
      sourceId: await getSourceId(ctx, s.source),
      startTs: start.utc,
      endTs: end && end.utc >= start.utc ? end.utc : null,
      tzOffsetMin: start.tzOffsetMin,
      value: s.value,
      valueKey: quantize(s.value, type.quantize_scale),
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
