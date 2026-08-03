// Explorer reads: N metrics over one arbitrary window, on ONE shared time
// axis, so shapes can be compared by eye.
//
// Granularity is chosen from the width of the window, never by the user:
// 2880 minute buckets over two days, 744 hourly buckets over a month and
// daily buckets beyond are the resolutions a 1400px chart can actually
// render. Asking the question is not the user's job; knowing what was
// aggregated is, so the chosen grain is displayed.
//
// The two-regime rule (architecture §2) is honoured exactly as in the daily
// series: raw_discrete metrics reduce observations with their declared
// aggregation, minute_cumulative metrics sum the XML channel strictly before
// the cutover and minute_stats from the cutover on. ONE deduplication
// difference is deliberate: the pre-cutover winning source is picked per
// BUCKET grain (per minute in the minute view) instead of per UTC hour. At
// that zoom an hour-wide winner would paint one spike per hour, which is a
// rendering artefact, not a measure. Consequence, stated rather than hidden:
// on pre-cutover days the minute view can total slightly differently from the
// daily view, because a different source can win in different minutes.
//
// Every series comes back on a DENSE bucket axis: a bucket with no data is
// null, never 0.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { cached } from './cache';
import { DERIVED_SLEEP, DERIVED_TRAINING, isDerived } from './catalog';
import { getMetricType, type Aggregation } from './metric-types';
import { heavyRead } from './read';
import { dailySeries, valueExpr } from './series';
import { sleepNights } from './sleep';
import { workoutMinutesPerDay } from './workouts';
import { addDays, daysBetween, type DayRange } from './time';

export type Granularity = 'day' | 'hour' | 'minute';

/** Above these widths the finer grain stops being renderable (and cheap). */
const MINUTE_MAX_DAYS = 2;
const HOUR_MAX_DAYS = 21;

export function chooseGranularity(range: DayRange): Granularity {
  const days = daysBetween(range.fromDay, range.toDayExcl);
  if (days <= MINUTE_MAX_DAYS) return 'minute';
  if (days <= HOUR_MAX_DAYS) return 'hour';
  return 'day';
}

const INTERVALS: Record<Granularity, string> = {
  day: '1 day',
  hour: '1 hour',
  minute: '1 minute',
};

export interface ExploreSeries {
  key: string;
  unit: string | null;
  aggregation: Aggregation;
  /** Current window, aligned index by index with the shared axis. */
  values: Array<number | null>;
  /** Reduction over the current window (sum for totals, mean otherwise). */
  current: number | null;
  /** Same reduction over the comparison window; null when it has no data. */
  previous: number | null;
  deltaPct: number | null;
  min: number | null;
  max: number | null;
  /** Buckets carrying a measure, out of the axis length. */
  measured: number;
}

export interface ExploreChart {
  granularity: Granularity;
  /** Local day strings at day granularity, null otherwise. */
  days: string[] | null;
  /** Bucket start instants at hour/minute granularity, null otherwise. */
  buckets: Date[] | null;
  axisLength: number;
  series: ExploreSeries[];
}

function reduce(values: Array<number | null>, aggregation: Aggregation): number | null {
  let acc = 0;
  let n = 0;
  for (const v of values) {
    if (v === null) continue;
    acc += v;
    n += 1;
  }
  if (n === 0) return null;
  return aggregation === 'sum' || aggregation === 'duration' ? acc : acc / n;
}

function extremes(values: Array<number | null>): { min: number | null; max: number | null; measured: number } {
  let min: number | null = null;
  let max: number | null = null;
  let measured = 0;
  for (const v of values) {
    if (v === null) continue;
    measured += 1;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  return { min, max, measured };
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// --- bucketed SQL (hour and minute) -----------------------------------------

const DISCRETE_BUCKET_SQL = (agg: string) => `
with bounds as (
  select ($3::date::timestamp at time zone $5) as from_ts,
         ($4::date::timestamp at time zone $5) as to_ts
),
buckets as (
  select b as bucket
  from bounds, generate_series(bounds.from_ts, bounds.to_ts - $6::interval, $6::interval) b
),
agg as (
  select date_bin($6::interval, o.start_ts, b.from_ts) as bucket, ${agg} as value
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2
    and o.start_ts >= b.from_ts and o.start_ts < b.to_ts
  group by 1
)
select buckets.bucket, agg.value
from buckets left join agg using (bucket)
order by buckets.bucket`;

const CUMULATIVE_BUCKET_SQL = (dedupGrain: 'hour' | 'minute') => `
with bounds as (
  select ($3::date::timestamp at time zone $5) as from_ts,
         ($4::date::timestamp at time zone $5) as to_ts,
         coalesce((select c.cutover_ts from channel_cutovers c
                   where c.subject_id = $1 and c.type_id = $2),
                  'infinity'::timestamptz) as cutover_ts
),
buckets as (
  select b as bucket
  from bounds, generate_series(bounds.from_ts, bounds.to_ts - $6::interval, $6::interval) b
),
raw_grain as (
  select date_trunc('${dedupGrain}', o.start_ts) as ts, o.source_id, sum(o.value) as v
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2 and o.origin = 'health_xml'
    and o.start_ts >= b.from_ts and o.start_ts < least(b.to_ts, b.cutover_ts)
  group by 1, 2
),
raw_winner as (
  select distinct on (h.ts) h.ts, h.v
  from raw_grain h
  join sources s on s.id = h.source_id
  left join source_priorities p
    on p.subject_id = $1 and p.type_id = $2 and p.source_id = h.source_id
  order by h.ts, p.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
),
minute as (
  select m.minute_ts as ts, m.value as v
  from minute_stats m, bounds b
  where m.subject_id = $1 and m.type_id = $2
    and m.minute_ts >= greatest(b.from_ts, b.cutover_ts) and m.minute_ts < b.to_ts
),
agg as (
  select date_bin($6::interval, u.ts, (select from_ts from bounds)) as bucket, sum(u.v) as value
  from (select ts, v from raw_winner union all select ts, v from minute) u
  group by 1
)
select buckets.bucket, agg.value
from buckets left join agg using (bucket)
order by buckets.bucket`;

interface BucketRow {
  bucket: Date;
  value: number | null;
}

/** Dense bucket series for one quantity type. Hour and minute grains only. */
async function bucketSeries(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  granularity: 'hour' | 'minute'
): Promise<BucketRow[]> {
  const type = await getMetricType(hkIdentifier);
  if (type.kind !== 'quantity') throw new Error(`not a quantity type: ${hkIdentifier}`);
  const sql =
    type.haeRegime === 'minute_cumulative'
      ? CUMULATIVE_BUCKET_SQL(granularity === 'minute' ? 'minute' : 'hour')
      : DISCRETE_BUCKET_SQL(valueExpr(type.aggregation));
  return heavyRead<BucketRow>(sql, [
    ctx.subjectId,
    type.id,
    range.fromDay,
    range.toDayExcl,
    ctx.timezone,
    INTERVALS[granularity],
  ]);
}

// --- derived daily series ----------------------------------------------------

/** Hours asleep per night, keyed by wake date. */
async function sleepHoursByDay(ctx: SubjectContext, range: DayRange): Promise<Map<string, number>> {
  const nights = await sleepNights(ctx, range);
  const out = new Map<string, number>();
  for (const n of nights) {
    if (n.asleepS !== null) out.set(n.nightDate, n.asleepS / 3600);
  }
  return out;
}

async function derivedByDay(
  ctx: SubjectContext,
  key: string,
  range: DayRange
): Promise<Map<string, number>> {
  if (key === DERIVED_SLEEP) return sleepHoursByDay(ctx, range);
  if (key === DERIVED_TRAINING) return workoutMinutesPerDay(ctx, range);
  throw new Error(`unknown derived series: ${key}`);
}

const DERIVED_UNITS: Record<string, { unit: string; aggregation: Aggregation }> = {
  [DERIVED_SLEEP]: { unit: 'h', aggregation: 'average' },
  [DERIVED_TRAINING]: { unit: 'min', aggregation: 'sum' },
};

// --- orchestration -----------------------------------------------------------

function daysOf(range: DayRange): string[] {
  const days: string[] = [];
  for (let d = range.fromDay; d < range.toDayExcl; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Beyond a year of days the raw scan leaves the 500ms budget (measured: 2.7s
 * for 14 years of heart rate), exactly like the dashboard's all-time series.
 * Same answer while rollups are being built: memoize per subject, series,
 * window and local day. The key does NOT embed the channel cutover, unlike
 * the dashboard cache: on an exploration screen a window that lags a cutover
 * move by at most the TTL is acceptable, a 3-second page is not.
 */
const LONG_RANGE_DAYS = 370;
const LONG_RANGE_TTL_MS = 30 * 60_000;

function fetchDailyValues(
  ctx: SubjectContext,
  key: string,
  combined: DayRange,
  today: string
): Promise<{ values: Array<number | null>; unit: string | null; aggregation: Aggregation }> {
  const compute = async () => {
    const full = await dailySeries(ctx, key, combined);
    return {
      values: full.points.map((p) => p.value),
      unit: full.unit,
      aggregation: full.aggregation,
    };
  };
  if (daysBetween(combined.fromDay, combined.toDayExcl) <= LONG_RANGE_DAYS) return compute();
  return cached(
    `explore:${ctx.subjectId}:${key}:${combined.fromDay}:${combined.toDayExcl}:${today}`,
    LONG_RANGE_TTL_MS,
    compute
  );
}

/**
 * One combined fetch per series over [previous.fromDay, range.toDayExcl),
 * sliced into the visible window and its comparison window. Same trick as
 * trends.ts: one round trip carries both the curve and its delta, and the
 * two can never disagree.
 */
export async function exploreChart(
  ctx: SubjectContext,
  keys: string[],
  range: DayRange,
  previous: DayRange,
  elapsed: number,
  today: string
): Promise<ExploreChart> {
  const granularity = chooseGranularity(range);
  const combined: DayRange = { fromDay: previous.fromDay, toDayExcl: range.toDayExcl };
  // Derived series are daily facts: they have nothing to say inside an hour.
  const usable = granularity === 'day' ? keys : keys.filter((k) => !isDerived(k));

  if (granularity === 'day') {
    const days = daysOf(range);
    const prevDays = daysOf(previous);
    const offset = daysBetween(previous.fromDay, range.fromDay);

    const series = await Promise.all(
      usable.map(async (key): Promise<ExploreSeries> => {
        if (isDerived(key)) {
          const meta = DERIVED_UNITS[key];
          const byDay = await derivedByDay(ctx, key, combined);
          const values = days.map((d) => byDay.get(d) ?? null);
          const prevValues = prevDays.map((d) => byDay.get(d) ?? null);
          const current = reduce(values.slice(0, elapsed), meta.aggregation);
          const prev = reduce(prevValues, meta.aggregation);
          return {
            key,
            unit: meta.unit,
            aggregation: meta.aggregation,
            values,
            current,
            previous: prev,
            deltaPct: pctDelta(current, prev),
            ...extremes(values),
          };
        }
        const full = await fetchDailyValues(ctx, key, combined, today);
        const all = full.values;
        const values = all.slice(offset);
        const prevValues = all.slice(0, prevDays.length);
        const current = reduce(values.slice(0, elapsed), full.aggregation);
        const prev = reduce(prevValues, full.aggregation);
        return {
          key,
          unit: full.unit,
          aggregation: full.aggregation,
          values,
          current,
          previous: prev,
          deltaPct: pctDelta(current, prev),
          ...extremes(values),
        };
      })
    );

    return { granularity, days, buckets: null, axisLength: days.length, series };
  }

  // Hour and minute: the split between the two windows is found on the bucket
  // instants themselves, so DST-shortened days cannot misalign the slice.
  const { rows } = await getDb().query<{ ts: Date }>(
    `select ($1::date::timestamp at time zone $2) as ts`,
    [range.fromDay, ctx.timezone]
  );
  const currentStartMs = rows[0].ts.getTime();

  const fetched = await Promise.all(
    usable.map(async (key) => ({ key, rows: await bucketSeries(ctx, key, combined, granularity) }))
  );

  const reference = fetched.find((f) => f.rows.length > 0);
  const allBuckets = reference ? reference.rows.map((r) => r.bucket) : [];
  const splitIndex = allBuckets.findIndex((b) => b.getTime() >= currentStartMs);
  const start = splitIndex < 0 ? allBuckets.length : splitIndex;
  const buckets = allBuckets.slice(start);

  const series = await Promise.all(
    fetched.map(async ({ key, rows: bucketRows }): Promise<ExploreSeries> => {
      const type = await getMetricType(key);
      const all = bucketRows.map((r) => r.value);
      const values = all.slice(start);
      const prevValues = all.slice(0, start);
      const current = reduce(values, type.aggregation);
      const prev = reduce(prevValues, type.aggregation);
      return {
        key,
        unit: type.canonicalUnit,
        aggregation: type.aggregation,
        values,
        current,
        previous: prev,
        deltaPct: pctDelta(current, prev),
        ...extremes(values),
      };
    })
  );

  return { granularity, days: null, buckets, axisLength: buckets.length, series };
}
