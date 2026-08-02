// HAE payload normalization (docs/hae-mapping.md is the contract).
// Two regimes, never merged: raw_discrete -> staging temp table, exact dedup within
// the hae origin, one-to-one XML<->HAE matching at ±1s (multiset, closest first,
// ambiguous journalized in counts, never silently dropped), then insertion of the
// unmatched; minute_cumulative -> minute_stats upsert under device authority
// (channel_cutovers). sleep_analysis daily summary -> sleep_daily channel 'hae'.
// blood_pressure is split into its two HK types. Workout avgHeartRate/maxHeartRate/
// heartRateData are recovery values and are NEVER ingested.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type pg from 'pg';
import { getDataDir } from '@/lib/ingest/receive';
import {
  isHaePayload,
  type HaeMetric,
  type HaePayload,
  type HaeWorkout,
  type HaeWorkoutSeriesPoint,
} from '@/lib/ingest/hae-types';

// ---------------------------------------------------------------------------
// HAE name -> HealthKit identifier (31 verified entries, docs/hae-mapping.md)

const HAE_TO_HK: Record<string, string> = {
  heart_rate: 'HKQuantityTypeIdentifierHeartRate',
  resting_heart_rate: 'HKQuantityTypeIdentifierRestingHeartRate',
  walking_heart_rate_average: 'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  heart_rate_variability: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  respiratory_rate: 'HKQuantityTypeIdentifierRespiratoryRate',
  blood_oxygen_saturation: 'HKQuantityTypeIdentifierOxygenSaturation',
  body_temperature: 'HKQuantityTypeIdentifierBodyTemperature',
  apple_sleeping_wrist_temperature:
    'HKQuantityTypeIdentifierAppleSleepingWristTemperature',
  breathing_disturbances: 'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances',
  headphone_audio_exposure: 'HKQuantityTypeIdentifierHeadphoneAudioExposure',
  physical_effort: 'HKQuantityTypeIdentifierPhysicalEffort',
  stair_speed_up: 'HKQuantityTypeIdentifierStairAscentSpeed',
  stair_speed_down: 'HKQuantityTypeIdentifierStairDescentSpeed',
  walking_speed: 'HKQuantityTypeIdentifierWalkingSpeed',
  walking_step_length: 'HKQuantityTypeIdentifierWalkingStepLength',
  walking_asymmetry_percentage: 'HKQuantityTypeIdentifierWalkingAsymmetryPercentage',
  walking_double_support_percentage:
    'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage',
  time_in_daylight: 'HKQuantityTypeIdentifierTimeInDaylight',
  dietary_water: 'HKQuantityTypeIdentifierDietaryWater',
  alcohol_consumption: 'HKQuantityTypeIdentifierNumberOfAlcoholicBeverages',
  step_count: 'HKQuantityTypeIdentifierStepCount',
  active_energy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  basal_energy_burned: 'HKQuantityTypeIdentifierBasalEnergyBurned',
  walking_running_distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
  flights_climbed: 'HKQuantityTypeIdentifierFlightsClimbed',
  apple_exercise_time: 'HKQuantityTypeIdentifierAppleExerciseTime',
  apple_stand_time: 'HKQuantityTypeIdentifierAppleStandTime',
  apple_stand_hour: 'HKCategoryTypeIdentifierAppleStandHour',
  sleep_analysis: 'HKCategoryTypeIdentifierSleepAnalysis',
  sexual_activity: 'HKCategoryTypeIdentifierSexualActivity',
};
const HK_BP_SYSTOLIC = 'HKQuantityTypeIdentifierBloodPressureSystolic';
const HK_BP_DIASTOLIC = 'HKQuantityTypeIdentifierBloodPressureDiastolic';

// HAE display name -> HKWorkoutActivityType*. Grows as activity types are observed.
const WORKOUT_ACTIVITY: Record<string, string> = {
  'Outdoor Run': 'HKWorkoutActivityTypeRunning',
  'Indoor Run': 'HKWorkoutActivityTypeRunning',
  'Outdoor Walk': 'HKWorkoutActivityTypeWalking',
  'Indoor Walk': 'HKWorkoutActivityTypeWalking',
  'Outdoor Cycle': 'HKWorkoutActivityTypeCycling',
  'Indoor Cycle': 'HKWorkoutActivityTypeCycling',
  Hiking: 'HKWorkoutActivityTypeHiking',
  'Pool Swim': 'HKWorkoutActivityTypeSwimming',
  'Open Water Swim': 'HKWorkoutActivityTypeSwimming',
  'Functional Strength Training': 'HKWorkoutActivityTypeFunctionalStrengthTraining',
  'Traditional Strength Training': 'HKWorkoutActivityTypeTraditionalStrengthTraining',
  'Core Training': 'HKWorkoutActivityTypeCoreTraining',
  Yoga: 'HKWorkoutActivityTypeYoga',
  Elliptical: 'HKWorkoutActivityTypeElliptical',
  Rowing: 'HKWorkoutActivityTypeRowing',
  'Stair Stepper': 'HKWorkoutActivityTypeStairClimbing',
  'High Intensity Interval Training':
    'HKWorkoutActivityTypeHighIntensityIntervalTraining',
  HIIT: 'HKWorkoutActivityTypeHighIntensityIntervalTraining',
  Cooldown: 'HKWorkoutActivityTypeCooldown',
  'Mind and Body': 'HKWorkoutActivityTypeMindAndBody',
  Other: 'HKWorkoutActivityTypeOther',
};
const ACTIVITY_FALLBACK = 'HKWorkoutActivityTypeOther';

// ---------------------------------------------------------------------------
// Unit conversion, driven by the payload's units field (never assumed).

const UNIT_ALIAS: Record<string, string> = {
  bpm: 'count/min',
  steps: 'count',
  sec: 's',
  second: 's',
  minute: 'min',
  hour: 'hr',
  h: 'hr',
};

// Linear dimensions: factor to the dimension's base unit.
const DIMENSIONS: Record<string, Record<string, number>> = {
  energy: { kJ: 1, kcal: 4.184, Cal: 4.184, cal: 0.004184, J: 0.001 },
  ratio: { fraction: 1, '%': 0.01 },
  distance: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254 },
  speed: { 'm/s': 1, 'km/hr': 1 / 3.6, mph: 0.44704 },
  duration: { s: 1, min: 60, hr: 3600, ms: 0.001, d: 86400 },
  volume: { L: 1, mL: 0.001, dL: 0.1, fl_oz_us: 0.0295735 },
  mass: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237 },
};

function canonicalUnitName(name: string): string {
  return UNIT_ALIAS[name] ?? name;
}

/** Converts value from one unit to another; null when no known conversion exists. */
export function convertUnit(value: number, from: string, to: string): number | null {
  const f = canonicalUnitName(from);
  const t = canonicalUnitName(to);
  if (f === t) return value;
  // Temperature is affine, not linear.
  if ((f === 'degC' || f === 'degF') && (t === 'degC' || t === 'degF')) {
    return f === 'degC' ? value * 1.8 + 32 : (value - 32) / 1.8;
  }
  for (const table of Object.values(DIMENSIONS)) {
    const ff = table[f];
    const tf = table[t];
    if (ff !== undefined && tf !== undefined) return (value * ff) / tf;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing helpers

const HAE_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

export interface ParsedDate {
  utc: Date;
  tzOffsetMin: number;
}

/** Parses "YYYY-MM-DD HH:MM:SS ±HHMM" (local with explicit offset) to UTC + offset. */
export function parseHaeDate(raw: string): ParsedDate | null {
  const m = HAE_DATE_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const utcMs =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) -
    offset * 60_000;
  if (!Number.isFinite(utcMs)) return null;
  return { utc: new Date(utcMs), tzOffsetMin: offset };
}

/** Source normalization: U+00A0 -> space; composite sources (A|B) kept verbatim. */
export function normalizeSourceName(raw: string | undefined): string {
  return (raw ?? '').replace(/ /g, ' ').trim();
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// Validation step (worker: received -> validated)

export class BatchValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ValidatedBatch {
  payload: HaePayload;
  declaredRange: { min: Date; max: Date } | null;
}

const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

export function resolveRawPath(rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : join(getDataDir(), rawPath);
}

/**
 * Reads the stored gzip file, checks the wire checksum (the file is either the wire
 * bytes verbatim when the device sent gzip, or our own gzip of the wire bytes),
 * parses and shape-checks the JSON, and computes the observed time range.
 */
export async function readAndValidateBatchFile(
  rawPath: string,
  expectedSha256: Buffer
): Promise<ValidatedBatch> {
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
  if (!isHaePayload(parsed)) {
    throw new BatchValidationError('shape_invalid', 'body is not an HAE v2 payload');
  }

  let min: Date | null = null;
  let max: Date | null = null;
  const consider = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const p = parseHaeDate(raw);
    if (!p) return;
    if (min === null || p.utc < min) min = p.utc;
    if (max === null || p.utc > max) max = p.utc;
  };
  for (const metric of parsed.data.metrics ?? []) {
    if (!Array.isArray(metric?.data)) continue;
    for (const pt of metric.data) consider((pt as { date?: unknown }).date);
  }
  for (const w of parsed.data.workouts ?? []) {
    consider(w?.start);
    consider(w?.end);
  }
  return {
    payload: parsed,
    declaredRange: min !== null && max !== null ? { min, max } : null,
  };
}

// ---------------------------------------------------------------------------
// Normalization context and counters

interface MetricTypeRow {
  id: number;
  hk_identifier: string;
  kind: 'quantity' | 'category';
  hae_regime: 'raw_discrete' | 'minute_cumulative' | 'daily_summary' | 'unsupported';
  canonical_unit: string | null;
  quantize_scale: number | null;
  supported: boolean;
}

type MetricCounters = Record<string, number>;

export interface NormalizeCounts {
  metrics: Record<string, MetricCounters>;
  workouts?: MetricCounters;
}

function bump(counts: NormalizeCounts, name: string, key: string, by = 1): void {
  if (by === 0) return;
  const c = (counts.metrics[name] ??= {});
  c[key] = (c[key] ?? 0) + by;
}

export interface BatchForNormalize {
  id: string;
  subject_id: string;
  device_id: string;
}

interface Ctx {
  client: pg.PoolClient;
  batch: BatchForNormalize;
  counts: NormalizeCounts;
  types: Map<string, MetricTypeRow>; // by hk_identifier
  optOut: Set<number>; // type ids with subject_metric_settings.ingest = false
  subjectTimezone: string;
  sourceIds: Map<string, number>;
  unitIds: Map<string, number>;
}

async function getSourceId(ctx: Ctx, rawName: string | undefined): Promise<number> {
  const name = normalizeSourceName(rawName);
  const cached = ctx.sourceIds.get(name);
  if (cached !== undefined) return cached;
  const { rows } = await ctx.client.query<{ id: number }>(
    `insert into sources (name) values ($1)
     on conflict (name) do update set name = excluded.name
     returning id`,
    [name]
  );
  ctx.sourceIds.set(name, rows[0].id);
  return rows[0].id;
}

async function getUnitId(ctx: Ctx, rawName: string): Promise<number | null> {
  const name = rawName.trim();
  if (name === '') return null;
  const cached = ctx.unitIds.get(name);
  if (cached !== undefined) return cached;
  const { rows } = await ctx.client.query<{ id: number }>(
    `insert into units (name) values ($1)
     on conflict (name) do update set name = excluded.name
     returning id`,
    [name]
  );
  ctx.unitIds.set(name, rows[0].id);
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Raw regime: staging + XML<->HAE matching + insertion

interface StagedRaw {
  idx: number;
  haeName: string;
  typeId: number;
  sourceId: number;
  startTs: Date;
  tzOffsetMin: number;
  value: number;
  valueKey: string | null; // bigint as string
  originalUnitId: number | null;
}

function quantize(value: number, scale: number | null): string | null {
  if (scale === null) return null;
  return String(Math.round(value * scale));
}

async function stageRawPoints(ctx: Ctx, staged: StagedRaw[]): Promise<void> {
  await ctx.client.query(
    `create temp table staging_hae (
       idx integer primary key,
       type_id smallint not null,
       source_id smallint not null,
       start_ts timestamptz not null,
       tz_offset_min smallint not null,
       value double precision not null,
       value_key bigint,
       original_unit_id smallint
     ) on commit drop`
  );
  const CHUNK = 500;
  for (let i = 0; i < staged.length; i += CHUNK) {
    const slice = staged.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = slice.map((r, j) => {
      params.push(
        r.idx,
        r.typeId,
        r.sourceId,
        r.startTs,
        r.tzOffsetMin,
        r.value,
        r.valueKey,
        r.originalUnitId
      );
      const b = j * 8;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    await ctx.client.query(
      `insert into staging_hae
         (idx, type_id, source_id, start_ts, tz_offset_min, value, value_key, original_unit_id)
       values ${tuples.join(',')}`,
      params
    );
  }
}

/**
 * One-to-one multiset matching between staged HAE points and existing XML
 * observations at ±1s, closest first. Returns matched staging idx values and
 * ambiguous idx values (ties at equal distance competing for the same row are
 * journalized, never resolved arbitrarily and never silently dropped).
 */
function matchXmlMultiset(
  staged: Array<{ idx: number; typeId: number; sourceId: number; ts: number; valueKey: string }>,
  xml: Array<{ id: string; typeId: number; sourceId: number; ts: number; valueKey: string }>
): { matched: Set<number>; ambiguous: Set<number> } {
  const matched = new Set<number>();
  const ambiguous = new Set<number>();
  const byGroup = new Map<string, { s: typeof staged; x: typeof xml }>();
  const keyOf = (r: { typeId: number; sourceId: number; valueKey: string }) =>
    `${r.typeId}|${r.sourceId}|${r.valueKey}`;
  for (const s of staged) {
    const g = byGroup.get(keyOf(s)) ?? { s: [], x: [] };
    g.s.push(s);
    byGroup.set(keyOf(s), g);
  }
  for (const x of xml) {
    const g = byGroup.get(keyOf(x));
    if (g) g.x.push(x);
  }
  for (const g of byGroup.values()) {
    if (g.x.length === 0) continue;
    interface Pair {
      dt: number;
      sIdx: number;
      xId: string;
    }
    const pairs: Pair[] = [];
    for (const s of g.s) {
      for (const x of g.x) {
        const dt = Math.abs(s.ts - x.ts);
        if (dt <= 1000) pairs.push({ dt, sIdx: s.idx, xId: x.id });
      }
    }
    pairs.sort((a, b) => a.dt - b.dt || a.sIdx - b.sIdx || (a.xId < b.xId ? -1 : 1));
    const sUsed = new Set<number>();
    const xUsed = new Set<string>();
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (sUsed.has(p.sIdx) || xUsed.has(p.xId) || ambiguous.has(p.sIdx)) continue;
      // Tie detection: another viable pair at the exact same distance sharing one
      // endpoint means the closest-first choice would be arbitrary.
      const ties = pairs.filter(
        (q) =>
          q !== p &&
          q.dt === p.dt &&
          (q.sIdx === p.sIdx || q.xId === p.xId) &&
          !sUsed.has(q.sIdx) &&
          !xUsed.has(q.xId) &&
          !ambiguous.has(q.sIdx)
      );
      if (ties.length > 0) {
        ambiguous.add(p.sIdx);
        for (const q of ties) ambiguous.add(q.sIdx);
        continue;
      }
      sUsed.add(p.sIdx);
      xUsed.add(p.xId);
      matched.add(p.sIdx);
    }
  }
  return { matched, ambiguous };
}

async function normalizeRawRegime(ctx: Ctx, staged: StagedRaw[]): Promise<void> {
  if (staged.length === 0) return;
  const nameByIdx = new Map<number, string>();
  for (const r of staged) nameByIdx.set(r.idx, r.haeName);
  const nameByTypeId = new Map<number, string>();
  for (const r of staged) nameByTypeId.set(r.typeId, r.haeName);

  await stageRawPoints(ctx, staged);

  // Intra-batch exact dedup (HAE re-emissions are byte-stable).
  const dupBatch = await ctx.client.query<{ type_id: number }>(
    `delete from staging_hae a
     using staging_hae b
     where a.type_id = b.type_id and a.source_id = b.source_id
       and a.start_ts = b.start_ts and a.value_key is not distinct from b.value_key
       and a.idx > b.idx
     returning a.type_id`
  );
  for (const row of dupBatch.rows) {
    bump(ctx.counts, nameByTypeId.get(row.type_id) ?? String(row.type_id), 'deduped_batch');
  }

  // Exact dedup against already-ingested HAE observations (idempotent replay).
  const dupHae = await ctx.client.query<{ type_id: number }>(
    `delete from staging_hae s
     using observations o
     where o.subject_id = $1 and o.origin = 'hae'
       and o.type_id = s.type_id and o.source_id = s.source_id
       and o.start_ts = s.start_ts and o.value_key is not distinct from s.value_key
     returning s.type_id`,
    [ctx.batch.subject_id]
  );
  for (const row of dupHae.rows) {
    bump(ctx.counts, nameByTypeId.get(row.type_id) ?? String(row.type_id), 'deduped_hae');
  }

  // One-to-one XML<->HAE matching at ±1s.
  const remaining = await ctx.client.query<{
    idx: number;
    type_id: number;
    source_id: number;
    start_ts: Date;
    value_key: string | null;
  }>('select idx, type_id, source_id, start_ts, value_key from staging_hae');
  const matchableStaged = remaining.rows
    .filter((r) => r.value_key !== null)
    .map((r) => ({
      idx: r.idx,
      typeId: r.type_id,
      sourceId: r.source_id,
      ts: r.start_ts.getTime(),
      valueKey: r.value_key as string,
    }));
  if (matchableStaged.length > 0) {
    const typeIds = [...new Set(matchableStaged.map((r) => r.typeId))];
    const minTs = new Date(Math.min(...matchableStaged.map((r) => r.ts)) - 1000);
    const maxTs = new Date(Math.max(...matchableStaged.map((r) => r.ts)) + 1000);
    const xmlRes = await ctx.client.query<{
      id: string;
      type_id: number;
      source_id: number;
      start_ts: Date;
      value_key: string;
    }>(
      `select id::text as id, type_id, source_id, start_ts, value_key
       from observations
       where subject_id = $1 and origin = 'health_xml'
         and type_id = any($2::smallint[])
         and start_ts between $3 and $4
         and value_key is not null`,
      [ctx.batch.subject_id, typeIds, minTs, maxTs]
    );
    const { matched, ambiguous } = matchXmlMultiset(
      matchableStaged,
      xmlRes.rows.map((r) => ({
        id: r.id,
        typeId: r.type_id,
        sourceId: r.source_id,
        ts: r.start_ts.getTime(),
        valueKey: r.value_key,
      }))
    );
    for (const idx of matched) {
      bump(ctx.counts, nameByIdx.get(idx) ?? 'unknown', 'matched_xml');
    }
    for (const idx of ambiguous) {
      bump(ctx.counts, nameByIdx.get(idx) ?? 'unknown', 'ambiguous');
    }
    const toDrop = [...matched, ...ambiguous];
    if (toDrop.length > 0) {
      await ctx.client.query('delete from staging_hae where idx = any($1::integer[])', [
        toDrop,
      ]);
    }
  }

  // Insert the leftovers as new hae-origin observations.
  const inserted = await ctx.client.query<{ type_id: number }>(
    `insert into observations
       (subject_id, type_id, source_id, start_ts, value, value_key,
        tz_offset_min, origin, original_unit_id, ingest_batch_id)
     select $1, type_id, source_id, start_ts, value, value_key,
            tz_offset_min, 'hae', original_unit_id, $2
     from staging_hae
     returning type_id`,
    [ctx.batch.subject_id, ctx.batch.id]
  );
  for (const row of inserted.rows) {
    bump(ctx.counts, nameByTypeId.get(row.type_id) ?? String(row.type_id), 'inserted');
  }
}

// ---------------------------------------------------------------------------
// Minute regime: upsert under device authority (channel_cutovers)

interface MinutePoint {
  haeName: string;
  typeId: number;
  sourceId: number;
  minuteTs: Date;
  value: number;
}

async function normalizeMinuteRegime(ctx: Ctx, points: MinutePoint[]): Promise<void> {
  if (points.length === 0) return;
  const byType = new Map<number, MinutePoint[]>();
  for (const p of points) {
    const list = byType.get(p.typeId) ?? [];
    list.push(p);
    byType.set(p.typeId, list);
  }

  for (const [typeId, rawPts] of byType) {
    const name = rawPts[0].haeName;
    // Dedupe within the batch: one upsert command cannot touch the same
    // (subject, type, minute) twice. Last occurrence wins, drops are counted.
    const byMinute = new Map<number, MinutePoint>();
    for (const p of rawPts) byMinute.set(p.minuteTs.getTime(), p);
    const pts = [...byMinute.values()];
    bump(ctx.counts, name, 'minute_deduped_batch', rawPts.length - pts.length);
    // Cutover bootstrap: the first device ever seen for (subject, type) becomes
    // authoritative, cutover at its earliest minute. Monotone: never moved here.
    const minTs = new Date(Math.min(...pts.map((p) => p.minuteTs.getTime())));
    await ctx.client.query(
      `insert into channel_cutovers (subject_id, type_id, cutover_ts, device_id)
       values ($1, $2, date_trunc('minute', $3::timestamptz), $4)
       on conflict (subject_id, type_id) do nothing`,
      [ctx.batch.subject_id, typeId, minTs, ctx.batch.device_id]
    );
    const cut = await ctx.client.query<{ cutover_ts: Date; device_id: string }>(
      'select cutover_ts, device_id from channel_cutovers where subject_id = $1 and type_id = $2',
      [ctx.batch.subject_id, typeId]
    );
    const cutover = cut.rows[0];
    const authoritative = cutover.device_id === ctx.batch.device_id;

    if (authoritative) {
      const usable = pts.filter((p) => p.minuteTs >= cutover.cutover_ts);
      bump(ctx.counts, name, 'pre_cutover_skipped', pts.length - usable.length);
      const CHUNK = 500;
      for (let i = 0; i < usable.length; i += CHUNK) {
        const slice = usable.slice(i, i + CHUNK);
        const params: unknown[] = [ctx.batch.subject_id, typeId, ctx.batch.device_id, ctx.batch.id];
        const tuples = slice.map((p, j) => {
          params.push(p.minuteTs, p.value, p.sourceId);
          const b = 4 + j * 3;
          return `($1, $2::smallint, $${b + 1}::timestamptz, $${b + 2}::float8, $${b + 3}::smallint, $3, $4)`;
        });
        const res = await ctx.client.query<{ inserted: boolean }>(
          `insert into minute_stats
             (subject_id, type_id, minute_ts, value, source_id, device_id, ingest_batch_id)
           values ${tuples.join(',')}
           on conflict (subject_id, type_id, minute_ts) do update
             set value = excluded.value, source_id = excluded.source_id,
                 device_id = excluded.device_id, ingest_batch_id = excluded.ingest_batch_id,
                 updated_at = now()
             where minute_stats.value is distinct from excluded.value
           returning (xmax = 0) as inserted`,
          params
        );
        let ins = 0;
        let upd = 0;
        for (const r of res.rows) (r.inserted ? ins++ : upd++);
        bump(ctx.counts, name, 'minute_inserted', ins);
        bump(ctx.counts, name, 'minute_updated', upd);
        bump(ctx.counts, name, 'minute_duplicate', slice.length - res.rows.length);
      }
    } else {
      // Non-authoritative device: equal value = counted duplicate; anything else is
      // recorded in minute_conflicts, never a silent overwrite, never a silent drop.
      const existing = await ctx.client.query<{ minute_ts: Date; value: number }>(
        `select minute_ts, value from minute_stats
         where subject_id = $1 and type_id = $2 and minute_ts = any($3::timestamptz[])`,
        [ctx.batch.subject_id, typeId, pts.map((p) => p.minuteTs)]
      );
      const existingByMinute = new Map<number, number>();
      for (const r of existing.rows) existingByMinute.set(r.minute_ts.getTime(), r.value);
      const conflicts: MinutePoint[] = [];
      for (const p of pts) {
        const cur = existingByMinute.get(p.minuteTs.getTime());
        if (cur !== undefined && cur === p.value) {
          bump(ctx.counts, name, 'minute_duplicate');
        } else {
          conflicts.push(p);
        }
      }
      for (const p of conflicts) {
        const res = await ctx.client.query(
          `insert into minute_conflicts (subject_id, type_id, minute_ts, device_id, value)
           values ($1, $2, $3, $4, $5)
           on conflict (subject_id, type_id, minute_ts, device_id) do nothing`,
          [ctx.batch.subject_id, typeId, p.minuteTs, ctx.batch.device_id, p.value]
        );
        bump(ctx.counts, name, res.rowCount ? 'minute_conflict' : 'minute_conflict_duplicate');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Daily regime: sleep_analysis -> sleep_daily (channel 'hae')

async function normalizeSleepDaily(ctx: Ctx, metric: HaeMetric): Promise<void> {
  const name = metric.name;
  for (const pt of metric.data) {
    const p = pt as unknown as Record<string, unknown>;
    const parsed = typeof p.date === 'string' ? parseHaeDate(p.date) : null;
    if (!parsed) {
      bump(ctx.counts, name, 'skipped_bad_point');
      continue;
    }
    const toSeconds = (v: unknown): number | null => {
      if (!isFiniteNumber(v)) return null;
      const s = convertUnit(v, metric.units, 's');
      return s === null ? null : Math.round(s);
    };
    const nightDate = (p.date as string).slice(0, 10); // local date of the summary
    const sleepStart = typeof p.sleepStart === 'string' ? parseHaeDate(p.sleepStart) : null;
    const sleepEnd = typeof p.sleepEnd === 'string' ? parseHaeDate(p.sleepEnd) : null;
    await ctx.client.query(
      `insert into sleep_daily
         (subject_id, night_date, channel, night_timezone,
          asleep_s, core_s, deep_s, rem_s, awake_s, in_bed_s, sleep_start, sleep_end)
       values ($1, $2, 'hae', $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (subject_id, night_date, channel) do update
         set night_timezone = excluded.night_timezone,
             asleep_s = excluded.asleep_s, core_s = excluded.core_s,
             deep_s = excluded.deep_s, rem_s = excluded.rem_s,
             awake_s = excluded.awake_s, in_bed_s = excluded.in_bed_s,
             sleep_start = excluded.sleep_start, sleep_end = excluded.sleep_end`,
      [
        ctx.batch.subject_id,
        nightDate,
        ctx.subjectTimezone,
        toSeconds(p.asleep),
        toSeconds(p.core),
        toSeconds(p.deep),
        toSeconds(p.rem),
        toSeconds(p.awake),
        toSeconds(p.inBed),
        sleepStart?.utc ?? null,
        sleepEnd?.utc ?? null,
      ]
    );
    bump(ctx.counts, name, 'daily_upserted');
  }
}

// ---------------------------------------------------------------------------
// Workouts

function workoutCounters(counts: NormalizeCounts): MetricCounters {
  return (counts.workouts ??= {});
}

function qtyIn(
  q: { qty: number; units: string } | undefined,
  targetUnit: string
): number | null {
  if (!q || !isFiniteNumber(q.qty)) return null;
  return convertUnit(q.qty, q.units, targetUnit);
}

async function insertWorkoutSeries(
  ctx: Ctx,
  workoutId: string,
  series: string,
  points: HaeWorkoutSeriesPoint[] | undefined,
  targetUnit: string,
  wc: MetricCounters
): Promise<void> {
  if (!points || points.length === 0) return;
  const rows: Array<{ ts: Date; value: number }> = [];
  for (const p of points) {
    const parsed = parseHaeDate(p.date);
    const value = isFiniteNumber(p.qty) ? convertUnit(p.qty, p.units, targetUnit) : null;
    if (!parsed || value === null) {
      wc.points_skipped = (wc.points_skipped ?? 0) + 1;
      continue;
    }
    rows.push({ ts: parsed.utc, value });
  }
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [workoutId, series];
    const tuples = slice.map((r, j) => {
      params.push(r.ts, r.value);
      const b = 2 + j * 2;
      return `($1, $2, $${b + 1}::timestamptz, $${b + 2}::float8)`;
    });
    const res = await ctx.client.query(
      `insert into workout_points (workout_id, series, ts, value)
       values ${tuples.join(',')}
       on conflict (workout_id, series, ts) do nothing`,
      params
    );
    wc.points_inserted = (wc.points_inserted ?? 0) + (res.rowCount ?? 0);
    wc.points_duplicate = (wc.points_duplicate ?? 0) + slice.length - (res.rowCount ?? 0);
  }
}

async function normalizeWorkout(ctx: Ctx, w: HaeWorkout): Promise<void> {
  const wc = workoutCounters(ctx.counts);
  wc.received = (wc.received ?? 0) + 1;

  const start = typeof w.start === 'string' ? parseHaeDate(w.start) : null;
  const end = typeof w.end === 'string' ? parseHaeDate(w.end) : null;
  if (!start || !end || typeof w.id !== 'string' || !(end.utc > start.utc)) {
    wc.skipped_invalid = (wc.skipped_invalid ?? 0) + 1;
    return;
  }

  let activity = WORKOUT_ACTIVITY[w.name];
  if (activity === undefined) {
    activity = ACTIVITY_FALLBACK;
    wc.unmapped_activity = (wc.unmapped_activity ?? 0) + 1;
  }
  // HAE workouts carry no top-level source: derive it from the minute series.
  const seriesSource =
    w.activeEnergy?.[0]?.source ??
    w.basalEnergy?.[0]?.source ??
    w.stepCount?.[0]?.source ??
    w.walkingAndRunningDistance?.[0]?.source;
  const sourceId = await getSourceId(ctx, seriesSource);

  // Stable external identity first: replays must not create a second workout.
  const known = await ctx.client.query<{ workout_id: string }>(
    `select workout_id from workout_external_ids where namespace = 'hae' and external_id = $1`,
    [w.id]
  );
  let workoutId: string;
  if (known.rows.length > 0) {
    workoutId = known.rows[0].workout_id;
    wc.already_known = (wc.already_known ?? 0) + 1;
  } else {
    // Fingerprint match against the XML backfill (heuristic, not identity):
    // adopt only a single unambiguous candidate without an hae identity yet.
    const candidates = await ctx.client.query<{ id: string }>(
      `select w.id from workouts w
       where w.subject_id = $1 and w.activity_type = $2
         and w.start_ts = $3 and w.end_ts = $4 and w.source_id = $5
         and not exists (
           select 1 from workout_external_ids e
           where e.workout_id = w.id and e.namespace = 'hae'
         )
       limit 2`,
      [ctx.batch.subject_id, activity, start.utc, end.utc, sourceId]
    );
    if (candidates.rows.length === 1) {
      workoutId = candidates.rows[0].id;
      wc.matched_fingerprint = (wc.matched_fingerprint ?? 0) + 1;
    } else {
      if (candidates.rows.length > 1) {
        wc.ambiguous_fingerprint = (wc.ambiguous_fingerprint ?? 0) + 1;
      }
      const isIndoor =
        typeof w.isIndoor === 'boolean'
          ? w.isIndoor
          : typeof w.location === 'string'
            ? w.location === 'Indoor'
            : null;
      // Trusted aggregates only. avgHeartRate/maxHeartRate/heartRate/heartRateData
      // are post-workout recovery values: NEVER stored.
      const stats: Record<string, unknown> = { hae_name: w.name };
      const put = (key: string, v: number | null) => {
        if (v !== null) stats[key] = v;
      };
      put('active_energy_burned_kj', qtyIn(w.activeEnergyBurned, 'kJ'));
      put('flights_climbed', qtyIn(w.flightsClimbed, 'count'));
      put('step_cadence_per_min', qtyIn(w.stepCadence, 'count/min'));
      put('temperature_c', qtyIn(w.temperature, 'degC'));
      put('humidity_fraction', qtyIn(w.humidity, 'fraction'));
      put('intensity_kcal_hr_kg', w.intensity?.qty ?? null);
      if (typeof w.location === 'string') stats.location = w.location;

      const created = await ctx.client.query<{ id: string }>(
        `insert into workouts
           (subject_id, activity_type, source_id, start_ts, end_ts, tz_offset_min,
            is_indoor, duration_s, distance_m, energy_kj, elevation_up_m, stats)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          ctx.batch.subject_id,
          activity,
          sourceId,
          start.utc,
          end.utc,
          start.tzOffsetMin,
          isIndoor,
          isFiniteNumber(w.duration) ? w.duration : 0,
          qtyIn(w.distance, 'm'),
          qtyIn(w.totalEnergy, 'kJ'),
          qtyIn(w.elevationUp, 'm'),
          JSON.stringify(stats),
        ]
      );
      workoutId = created.rows[0].id;
      wc.created = (wc.created ?? 0) + 1;
    }
    await ctx.client.query(
      `insert into workout_external_ids (workout_id, namespace, external_id)
       values ($1, 'hae', $2)
       on conflict do nothing`,
      [workoutId, w.id]
    );
  }

  // Minute series -> workout_points. Units are canonical: kJ for energy, count for
  // steps, m for distance. heartRateData (recovery) is deliberately absent.
  await insertWorkoutSeries(ctx, workoutId, 'active_energy', w.activeEnergy, 'kJ', wc);
  await insertWorkoutSeries(ctx, workoutId, 'basal_energy', w.basalEnergy, 'kJ', wc);
  await insertWorkoutSeries(ctx, workoutId, 'step_count', w.stepCount, 'count', wc);
  await insertWorkoutSeries(
    ctx,
    workoutId,
    'walking_running_distance',
    w.walkingAndRunningDistance,
    'm',
    wc
  );

  // Inline GPS route -> workout_route_points (speed observed in m/s).
  const route = Array.isArray(w.route) ? w.route : [];
  const rows: Array<[Date, number, number, number | null, number | null, number | null, number | null]> = [];
  for (const p of route) {
    const ts = typeof p.timestamp === 'string' ? parseHaeDate(p.timestamp) : null;
    if (!ts || !isFiniteNumber(p.latitude) || !isFiniteNumber(p.longitude)) {
      wc.route_points_skipped = (wc.route_points_skipped ?? 0) + 1;
      continue;
    }
    rows.push([
      ts.utc,
      p.latitude,
      p.longitude,
      isFiniteNumber(p.altitude) ? p.altitude : null,
      isFiniteNumber(p.speed) ? p.speed : null,
      isFiniteNumber(p.course) ? p.course : null,
      isFiniteNumber(p.horizontalAccuracy) ? p.horizontalAccuracy : null,
    ]);
  }
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params: unknown[] = [workoutId];
    const tuples = slice.map((r, j) => {
      params.push(...r);
      const b = 1 + j * 7;
      return `($1, $${b + 1}::timestamptz, $${b + 2}::float8, $${b + 3}::float8, $${b + 4}::float8, $${b + 5}::float8, $${b + 6}::float8, $${b + 7}::float8)`;
    });
    const res = await ctx.client.query(
      `insert into workout_route_points
         (workout_id, ts, lat, lon, altitude_m, speed_ms, course_deg, h_acc_m)
       values ${tuples.join(',')}
       on conflict (workout_id, ts) do nothing`,
      params
    );
    wc.route_points_inserted = (wc.route_points_inserted ?? 0) + (res.rowCount ?? 0);
    wc.route_points_duplicate =
      (wc.route_points_duplicate ?? 0) + slice.length - (res.rowCount ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Entry point

/**
 * Normalizes a validated HAE payload inside the caller's open transaction.
 * Takes one advisory xact lock per (subject, type) touched (sorted, deadlock-free)
 * plus one for the workout namespace, so two workers can never interleave writes
 * for the same series. Returns detailed per-type counters for ingest_batches.counts.
 */
export async function normalizeHaePayload(
  client: pg.PoolClient,
  batch: BatchForNormalize,
  payload: HaePayload
): Promise<NormalizeCounts> {
  const counts: NormalizeCounts = { metrics: {} };

  const typesRes = await client.query<MetricTypeRow>(
    `select mt.id, mt.hk_identifier, mt.kind, mt.hae_regime,
            u.name as canonical_unit, mt.quantize_scale, mt.supported
     from metric_types mt
     left join units u on u.id = mt.canonical_unit_id`
  );
  const types = new Map<string, MetricTypeRow>();
  for (const t of typesRes.rows) types.set(t.hk_identifier, t);

  const optOutRes = await client.query<{ type_id: number }>(
    'select type_id from subject_metric_settings where subject_id = $1 and ingest = false',
    [batch.subject_id]
  );
  const optOut = new Set(optOutRes.rows.map((r) => r.type_id));

  const subjRes = await client.query<{ timezone: string }>(
    'select timezone from subjects where id = $1',
    [batch.subject_id]
  );
  if (subjRes.rows.length === 0) throw new Error('subject not found');

  const ctx: Ctx = {
    client,
    batch,
    counts,
    types,
    optOut,
    subjectTimezone: subjRes.rows[0].timezone,
    sourceIds: new Map(),
    unitIds: new Map(),
  };

  const metrics = payload.data.metrics ?? [];
  const workouts = payload.data.workouts ?? [];

  // Advisory locks per (subject, type), plus key 0 for workouts, in ascending order.
  const lockKeys = new Set<number>();
  if (workouts.length > 0) lockKeys.add(0);
  for (const metric of metrics) {
    const hks =
      metric.name === 'blood_pressure'
        ? [HK_BP_SYSTOLIC, HK_BP_DIASTOLIC]
        : [HAE_TO_HK[metric.name]];
    for (const hk of hks) {
      const t = hk ? types.get(hk) : undefined;
      if (t) lockKeys.add(t.id);
    }
  }
  for (const key of [...lockKeys].sort((a, b) => a - b)) {
    await client.query('select pg_advisory_xact_lock(hashtext($1), $2)', [
      batch.subject_id,
      key,
    ]);
  }

  const stagedRaw: StagedRaw[] = [];
  let stagedIdx = 0;
  const minutePoints: MinutePoint[] = [];

  const resolveType = (haeName: string, hk: string | undefined): MetricTypeRow | null => {
    if (!hk) {
      bump(counts, haeName, 'skipped_unknown_type');
      return null;
    }
    const t = types.get(hk);
    if (!t) {
      bump(counts, haeName, 'skipped_unknown_type');
      return null;
    }
    if (!t.supported) {
      bump(counts, haeName, 'skipped_unsupported');
      return null;
    }
    if (optOut.has(t.id)) {
      bump(counts, haeName, 'skipped_opt_out');
      return null;
    }
    return t;
  };

  const stageValue = async (
    metric: HaeMetric,
    type: MetricTypeRow,
    dateRaw: string,
    rawValue: number,
    source: string | undefined
  ): Promise<void> => {
    const parsed = parseHaeDate(dateRaw);
    if (!parsed || !isFiniteNumber(rawValue)) {
      bump(counts, metric.name, 'skipped_bad_point');
      return;
    }
    const canonical = type.canonical_unit ?? metric.units;
    const value = convertUnit(rawValue, metric.units, canonical);
    if (value === null) {
      bump(counts, metric.name, 'skipped_unit');
      return;
    }
    stagedRaw.push({
      idx: stagedIdx++,
      haeName: metric.name,
      typeId: type.id,
      sourceId: await getSourceId(ctx, source),
      startTs: parsed.utc,
      tzOffsetMin: parsed.tzOffsetMin,
      value,
      valueKey: quantize(value, type.quantize_scale),
      originalUnitId: await getUnitId(ctx, metric.units),
    });
  };

  for (const metric of metrics) {
    if (typeof metric?.name !== 'string' || !Array.isArray(metric.data)) continue;
    bump(counts, metric.name, 'received', metric.data.length);

    // blood_pressure: one JSON point = two HK records.
    if (metric.name === 'blood_pressure') {
      const tSys = resolveType(metric.name, HK_BP_SYSTOLIC);
      const tDia = tSys ? resolveType(metric.name, HK_BP_DIASTOLIC) : null;
      if (!tSys || !tDia) continue;
      for (const pt of metric.data) {
        const p = pt as { date?: string; systolic?: number; diastolic?: number; source?: string };
        if (typeof p.date !== 'string' || !isFiniteNumber(p.systolic) || !isFiniteNumber(p.diastolic)) {
          bump(counts, metric.name, 'skipped_bad_point');
          continue;
        }
        await stageValue(metric, tSys, p.date, p.systolic, p.source);
        await stageValue(metric, tDia, p.date, p.diastolic, p.source);
      }
      continue;
    }

    const type = resolveType(metric.name, HAE_TO_HK[metric.name]);
    if (!type) continue;

    if (type.hae_regime === 'daily_summary') {
      if (metric.name === 'sleep_analysis') {
        await normalizeSleepDaily(ctx, metric);
      } else {
        // apple_stand_hour, sexual_activity: no normalized target yet. Counted,
        // never silently dropped; the raw batch stays replayable for 30 days.
        bump(counts, metric.name, 'skipped_daily_unsupported', metric.data.length);
      }
      continue;
    }

    if (type.hae_regime === 'minute_cumulative') {
      const canonical = type.canonical_unit ?? metric.units;
      for (const pt of metric.data) {
        const p = pt as { date?: string; qty?: number; source?: string };
        const parsed = typeof p.date === 'string' ? parseHaeDate(p.date) : null;
        if (!parsed || !isFiniteNumber(p.qty)) {
          bump(counts, metric.name, 'skipped_bad_point');
          continue;
        }
        const value = convertUnit(p.qty, metric.units, canonical);
        if (value === null) {
          bump(counts, metric.name, 'skipped_unit');
          continue;
        }
        const minuteTs = new Date(Math.floor(parsed.utc.getTime() / 60_000) * 60_000);
        minutePoints.push({
          haeName: metric.name,
          typeId: type.id,
          sourceId: await getSourceId(ctx, p.source),
          minuteTs,
          value,
        });
      }
      continue;
    }

    if (type.hae_regime === 'raw_discrete') {
      if (metric.name === 'heart_rate') {
        // Raw samples keep Min==Avg==Max; anything else means the automation sent
        // aggregated data, which must not pollute the raw channel.
        for (const pt of metric.data) {
          const p = pt as { date?: string; Min?: number; Avg?: number; Max?: number; source?: string };
          if (
            typeof p.date !== 'string' ||
            !isFiniteNumber(p.Avg) ||
            !isFiniteNumber(p.Min) ||
            !isFiniteNumber(p.Max)
          ) {
            bump(counts, metric.name, 'skipped_bad_point');
            continue;
          }
          if (p.Min !== p.Avg || p.Avg !== p.Max) {
            bump(counts, metric.name, 'skipped_aggregated');
            continue;
          }
          await stageValue(metric, type, p.date, p.Avg, p.source);
        }
      } else {
        for (const pt of metric.data) {
          const p = pt as { date?: string; qty?: number; source?: string };
          if (typeof p.date !== 'string' || !isFiniteNumber(p.qty)) {
            bump(counts, metric.name, 'skipped_bad_point');
            continue;
          }
          await stageValue(metric, type, p.date, p.qty, p.source);
        }
      }
      continue;
    }

    bump(counts, metric.name, 'skipped_unsupported', metric.data.length);
  }

  await normalizeRawRegime(ctx, stagedRaw);
  await normalizeMinuteRegime(ctx, minutePoints);

  for (const w of workouts) {
    await normalizeWorkout(ctx, w);
  }

  return counts;
}
