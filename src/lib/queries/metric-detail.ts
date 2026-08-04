// Reads of the metric detail screen: one type, one window, everything the
// screen states about it. Nothing here knows a type by name — what to compute
// is decided from the taxonomy row (kind, aggregation, hae_regime, canonical
// unit), so a type promoted in the database tomorrow gets a correct page with
// no code change.
//
// Statistics are always computed from the DAILY series, even when the chart is
// drawn per hour or per minute. Two reasons, both about not lying: the daily
// series is the pipeline every other screen reduces (queries/series.ts, with
// its two-regime and rollup rules), so a total shown here cannot disagree with
// the same total on the dashboard; and a mean of hourly means weighs a quiet
// hour like a busy one, which is the classic wrong average.
//
// Two families of type, two shapes of truth:
//   - chartable = quantity with a declared aggregation. Curve or bars, a total
//     or a mean, min/max, a trend against the previous window.
//   - everything else (the *Event category types, MindfulSession,
//     AppleStandHour, and any quantity still carrying aggregation 'none') has
//     no average to compute: it gets occurrence counts per day and a
//     chronology. Averaging an alert count would be meaningless, and dividing
//     by zero aggregations is how a generic screen crashes on real data.
import { getDb } from '@/lib/db';
import { cached } from './cache';
import type { SubjectContext } from './context';
import { categoryDaysPerDay, occurrenceMode, type OccurrenceMode } from './inventory';
import { getMetricType, type Aggregation, type MetricTypeInfo } from './metric-types';
import { heavyRead } from './read';
import { dailySeries, type DailyPoint } from './series';
import { addDays, daysBetween, todayInZone, type DayRange } from './time';

/** A quantity type with a declared aggregation can be reduced and charted. */
export function isChartable(type: { kind: string; aggregation: Aggregation }): boolean {
  return type.kind === 'quantity' && type.aggregation !== 'none';
}

/** A daily cumulative reads as bars and as a calendar; a point measure as a curve. */
export function isCumulative(aggregation: Aggregation): boolean {
  return aggregation === 'sum' || aggregation === 'duration';
}

export interface MetricExtreme {
  value: number;
  /** Local day the extreme belongs to. */
  day: string;
  /**
   * Instant of the extreme raw sample. Null for a daily total: a day's sum is
   * not a moment, so it can never point at a session.
   */
  ts: Date | null;
  workoutId: string | null;
  workoutActivity: string | null;
}

export interface MetricWindowStats {
  type: MetricTypeInfo;
  /** Daily values over the visible window, dense, null where nothing measured. */
  days: string[];
  values: Array<number | null>;
  /** Same over the comparison window; empty when comparison is not applicable. */
  previousValues: Array<number | null>;
  /** Total for a cumulative, mean of day values otherwise. Null on an empty window. */
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
  /**
   * Extremes. For a cumulative these are the lowest and highest DAY; for a
   * point measure they are the lowest and highest raw SAMPLE, which is what a
   * max heart rate means.
   */
  low: MetricExtreme | null;
  high: MetricExtreme | null;
  /** Raw samples behind the window (merged contributions for cumulatives). */
  samples: number;
  daysMeasured: number;
  daysTotal: number;
}

/**
 * One figure for a window, per the type's declared aggregation. `latest` is
 * not a mean: the taxonomy uses it for states that persist between
 * measurements (body mass, height, a goal), and the answer to "what do I
 * weigh over August" is the last reading, not the average of the month.
 */
function reduce(values: Array<number | null>, aggregation: Aggregation): number | null {
  if (aggregation === 'latest') {
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      if (v !== null) return v;
    }
    return null;
  }
  let acc = 0;
  let n = 0;
  for (const v of values) {
    if (v === null) continue;
    acc += v;
    n += 1;
  }
  if (n === 0) return null;
  return isCumulative(aggregation) ? acc : acc / n;
}

function pctDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function daysOf(range: DayRange): string[] {
  const out: string[] = [];
  for (let d = range.fromDay; d < range.toDayExcl; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The extreme raw sample of one local day, with the session covering it when
 * there is one.
 *
 * `as materialized` is load-bearing, not style. Without it the planner inlines
 * the peak lookup and drives a nested loop from EVERY observation of the day
 * into the workout bounds: a thousand workouts probed per sample, 96 ms in
 * psql and 1.2 s inside the page. Materialized, the peak is one index range
 * scan and the workout lookup runs against a single instant: 6.8 ms, measured.
 *
 * A duplicated workout (two rows with identical bounds, a known fact of the
 * real export) covers the instant twice; the limit keeps one, which is all a
 * link needs.
 */
async function extremeSample(
  ctx: SubjectContext,
  type: MetricTypeInfo,
  day: string,
  direction: 'asc' | 'desc'
): Promise<{ ts: Date; value: number; workoutId: string | null; workoutActivity: string | null } | null> {
  interface Row {
    ts: Date;
    value: number;
    workout_id: string | null;
    activity_type: string | null;
  }
  const { rows } = await getDb().query<Row>(
    `with peak as materialized (
       select o.start_ts as ts, o.value
       from observations o
       where o.subject_id = $1 and o.type_id = $2
         and o.start_ts >= ($3::date::timestamp at time zone $4)
         and o.start_ts < (($3::date + 1)::timestamp at time zone $4)
         and o.value is not null
       order by o.value ${direction === 'asc' ? 'asc' : 'desc'}
       limit 1
     )
     select peak.ts, peak.value, w.id as workout_id, w.activity_type
     from peak
     left join workouts w
       on w.subject_id = $1 and w.start_ts <= peak.ts and w.end_ts > peak.ts
     limit 1`,
    [ctx.subjectId, type.id, day, ctx.timezone]
  );
  const r = rows[0];
  if (!r) return null;
  return { ts: r.ts, value: r.value, workoutId: r.workout_id, workoutActivity: r.activity_type };
}

/** Index of the smallest / largest non-null entry, or -1. */
function argExtreme(values: Array<number | null>, want: 'min' | 'max'): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const b = best < 0 ? null : values[best];
    if (b === null || (want === 'min' ? v < b : v > b)) best = i;
  }
  return best;
}

/**
 * Window statistics for a chartable type. ONE daily read over the combined
 * range [previous.fromDay, range.toDayExcl), sliced into the visible window
 * and its comparison: the same trick trends.ts uses, so the curve and its
 * delta can never come from two different reads and disagree.
 *
 * The current window is reduced over its ELAPSED days only. Comparing "August
 * so far" against a whole July would understate every total by construction.
 */
export async function metricWindowStats(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  previous: DayRange,
  elapsed: number
): Promise<MetricWindowStats> {
  const type = await getMetricType(hkIdentifier);
  const combined: DayRange = { fromDay: previous.fromDay, toDayExcl: range.toDayExcl };
  const series = await dailySeries(ctx, hkIdentifier, combined);

  const prevLen = daysBetween(previous.fromDay, previous.toDayExcl);
  const offset = daysBetween(previous.fromDay, range.fromDay);
  const points: DailyPoint[] = series.points.slice(offset);
  const prevPoints: DailyPoint[] = series.points.slice(0, prevLen);

  const days = daysOf(range);
  const values = points.map((p) => p.value);
  const previousValues = prevPoints.map((p) => p.value);
  const current = reduce(values.slice(0, elapsed), type.aggregation);
  const prev = reduce(previousValues, type.aggregation);

  const samples = points.reduce((acc, p) => acc + p.n, 0);
  const daysMeasured = points.filter((p) => p.value !== null).length;

  // A cumulative's extremes are days; a point measure's extremes are samples,
  // and the per-day min/max the daily series already carries locate the day
  // they happened on without a second scan of the window.
  let low: MetricExtreme | null = null;
  let high: MetricExtreme | null = null;
  if (isCumulative(type.aggregation)) {
    const lo = argExtreme(values, 'min');
    const hi = argExtreme(values, 'max');
    if (lo >= 0) low = { value: values[lo] as number, day: days[lo], ts: null, workoutId: null, workoutActivity: null };
    if (hi >= 0) high = { value: values[hi] as number, day: days[hi], ts: null, workoutId: null, workoutActivity: null };
  } else {
    const lo = argExtreme(points.map((p) => p.min), 'min');
    const hi = argExtreme(points.map((p) => p.max), 'max');
    const [loSample, hiSample] = await Promise.all([
      lo >= 0 ? extremeSample(ctx, type, days[lo], 'asc') : Promise.resolve(null),
      hi >= 0 ? extremeSample(ctx, type, days[hi], 'desc') : Promise.resolve(null),
    ]);
    if (lo >= 0 && loSample) {
      low = {
        value: loSample.value,
        day: days[lo],
        ts: loSample.ts,
        workoutId: loSample.workoutId,
        workoutActivity: loSample.workoutActivity,
      };
    }
    if (hi >= 0 && hiSample) {
      high = {
        value: hiSample.value,
        day: days[hi],
        ts: hiSample.ts,
        workoutId: hiSample.workoutId,
        workoutActivity: hiSample.workoutActivity,
      };
    }
  }

  return {
    type,
    days,
    values,
    previousValues,
    current,
    previous: prev,
    deltaPct: pctDelta(current, prev),
    low,
    high,
    samples,
    daysMeasured,
    daysTotal: days.length,
  };
}

// --- occurrence types --------------------------------------------------------

export interface MetricOccurrenceStats {
  type: MetricTypeInfo;
  /** 'count' for point events, 'duration' (seconds) for events that occupy time. */
  mode: OccurrenceMode;
  days: string[];
  /** Occurrences or seconds per local day, null (never 0) on a day with nothing. */
  counts: Array<number | null>;
  total: number;
  previousTotal: number;
  deltaPct: number | null;
  daysMeasured: number;
  daysTotal: number;
}

/** Counts (or seconds) per day for a type that has no value to average. */
export async function metricOccurrenceStats(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  previous: DayRange,
  elapsed: number
): Promise<MetricOccurrenceStats> {
  const type = await getMetricType(hkIdentifier);
  const mode = occurrenceMode(type.aggregation);
  const combined: DayRange = { fromDay: previous.fromDay, toDayExcl: range.toDayExcl };
  const all = await categoryDaysPerDay(ctx, type.id, combined, mode);

  const prevLen = daysBetween(previous.fromDay, previous.toDayExcl);
  const offset = daysBetween(previous.fromDay, range.fromDay);
  const counts = all.slice(offset);
  const prevCounts = all.slice(0, prevLen);
  const sum = (xs: Array<number | null>) => xs.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const total = sum(counts.slice(0, elapsed));
  const previousTotal = sum(prevCounts);

  return {
    type,
    mode,
    days: daysOf(range),
    counts,
    total,
    previousTotal,
    deltaPct: previousTotal === 0 ? null : ((total - previousTotal) / previousTotal) * 100,
    daysMeasured: counts.filter((v) => v !== null).length,
    daysTotal: counts.length,
  };
}

export interface CategoryValueCount {
  /** Stable slug from metric_category_values; null when the row carries none. */
  slug: string | null;
  n: number;
  sharePct: number;
}

/**
 * Occurrences per category value over the window. AppleStandHour records both
 * "stood" and "idle" hours, and the audio-exposure events distinguish a
 * momentary limit from a seven-day one: a bare occurrence count would mix
 * facts that mean opposite things. The enum comes from
 * metric_category_values, the contract that lives in the database.
 */
export async function metricCategoryBreakdown(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange
): Promise<CategoryValueCount[]> {
  const type = await getMetricType(hkIdentifier);
  interface Row {
    slug: string | null;
    n: string;
  }
  const rows = await heavyRead<Row>(
    `select v.slug, count(*) as n
     from observations o
     left join metric_category_values v
       on v.type_id = o.type_id and v.raw_value = o.category_value
     where o.subject_id = $1 and o.type_id = $2
       and o.start_ts >= ($3::date::timestamp at time zone $5)
       and o.start_ts < ($4::date::timestamp at time zone $5)
     group by v.slug
     order by count(*) desc`,
    [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone]
  );
  const total = rows.reduce((acc, r) => acc + Number(r.n), 0);
  return rows.map((r) => ({
    slug: r.slug,
    n: Number(r.n),
    sharePct: total > 0 ? (Number(r.n) / total) * 100 : 0,
  }));
}

export interface OccurrenceRow {
  ts: Date;
  sourceName: string;
  /** Category slug from metric_category_values; null when the type declares none. */
  slug: string | null;
  /** Duration in seconds when the record carries an interval. */
  durationS: number | null;
}

/**
 * Most recent occurrences inside the window, newest first. The category value
 * is resolved through metric_category_values, the enum contract that lives in
 * the database: no slug is ever guessed from a raw integer here.
 */
export async function metricOccurrences(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  limit = 60
): Promise<OccurrenceRow[]> {
  const type = await getMetricType(hkIdentifier);
  interface Row {
    ts: Date;
    source_name: string;
    slug: string | null;
    duration_s: number | null;
  }
  const { rows } = await getDb().query<Row>(
    `select o.start_ts as ts, s.name as source_name, v.slug,
            case when o.end_ts is null then null
                 else extract(epoch from o.end_ts - o.start_ts) end as duration_s
     from observations o
     join sources s on s.id = o.source_id
     left join metric_category_values v
       on v.type_id = o.type_id and v.raw_value = o.category_value
     where o.subject_id = $1 and o.type_id = $2
       and o.start_ts >= ($3::date::timestamp at time zone $5)
       and o.start_ts < ($4::date::timestamp at time zone $5)
     order by o.start_ts desc
     limit $6`,
    [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone, limit]
  );
  return rows.map((r) => ({
    ts: r.ts,
    sourceName: r.source_name,
    slug: r.slug,
    durationS: r.duration_s === null ? null : Number(r.duration_s),
  }));
}

// --- provenance --------------------------------------------------------------

export interface SourceShare {
  name: string;
  rows: number;
  sharePct: number;
  firstTs: Date;
  lastTs: Date;
  /** True when the rows come from the HAE minute channel, not the XML export. */
  minuteChannel: boolean;
}

/**
 * Which devices recorded this type over the window, and how much each. Both
 * channels are counted, because a cumulative type usually has an XML history
 * and a minute_stats present, and showing only one would credit the wrong
 * device for the recent data.
 *
 * This read scans the window row by row (no index carries source_id), which
 * makes it the one query of the screen that grows with the window: 6 ms on a
 * month of heart rate, 378 ms on a year, 1.75 s all-time. Two consequences,
 * both deliberate:
 *   - the panel is SECONDARY and lives in its own Suspense boundary, so the
 *     figures and the chart are never held back by it;
 *   - the result is cached per subject, type, window and local day. Provenance
 *     only changes when data is ingested, so a second visit to a wide window
 *     is free and the all-time case is paid once per ten minutes at worst.
 * Measured, not assumed.
 */
export async function metricSources(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange
): Promise<SourceShare[]> {
  const type = await getMetricType(hkIdentifier);
  interface Row {
    name: string;
    n: string;
    first_ts: Date;
    last_ts: Date;
    minute_channel: boolean;
  }
  const key = `sources:${ctx.subjectId}:${type.id}:${range.fromDay}:${range.toDayExcl}:${todayInZone(ctx.timezone)}`;
  const rows = await cached(key, 10 * 60_000, () =>
    heavyRead<Row>(
      `with bounds as (
       select ($3::date::timestamp at time zone $5) as from_ts,
              ($4::date::timestamp at time zone $5) as to_ts
     ),
     channels as (
       select o.source_id, o.start_ts as ts, false as minute_channel
       from observations o, bounds b
       where o.subject_id = $1 and o.type_id = $2
         and o.start_ts >= b.from_ts and o.start_ts < b.to_ts
       union all
       select m.source_id, m.minute_ts as ts, true as minute_channel
       from minute_stats m, bounds b
       where m.subject_id = $1 and m.type_id = $2
         and m.minute_ts >= b.from_ts and m.minute_ts < b.to_ts
     )
     select s.name, count(*) as n, min(c.ts) as first_ts, max(c.ts) as last_ts,
            bool_or(c.minute_channel) as minute_channel
     from channels c join sources s on s.id = c.source_id
     group by s.name
     order by count(*) desc, s.name`,
      [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone]
    )
  );
  const total = rows.reduce((acc, r) => acc + Number(r.n), 0);
  return rows.map((r) => ({
    name: r.name,
    rows: Number(r.n),
    sharePct: total > 0 ? (Number(r.n) / total) * 100 : 0,
    firstTs: r.first_ts,
    lastTs: r.last_ts,
    minuteChannel: r.minute_channel,
  }));
}

// --- raw samples -------------------------------------------------------------

export interface SampleRow {
  ts: Date;
  value: number | null;
  sourceName: string;
  /** Present when the row is a minute bucket from the HAE channel. */
  minuteChannel: boolean;
}

/**
 * The last raw measurements of the window, newest first. This is the answer to
 * "I logged three glasses of water yesterday, show them to me": an aggregate
 * is a summary, a sample list is the record itself.
 *
 * Reads both channels and merges them by instant. The index is scanned
 * backwards under a LIMIT, so the cost does not depend on the width of the
 * window (0.6 ms all-time, measured).
 */
export async function metricSamples(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  limit = 40
): Promise<SampleRow[]> {
  const type = await getMetricType(hkIdentifier);
  interface Row {
    ts: Date;
    value: number | null;
    name: string;
    minute_channel: boolean;
  }
  const { rows } = await getDb().query<Row>(
    `with bounds as (
       select ($3::date::timestamp at time zone $5) as from_ts,
              ($4::date::timestamp at time zone $5) as to_ts
     ),
     obs as (
       select o.start_ts as ts, o.value, o.source_id, false as minute_channel
       from observations o, bounds b
       where o.subject_id = $1 and o.type_id = $2
         and o.start_ts >= b.from_ts and o.start_ts < b.to_ts
       order by o.start_ts desc
       limit $6
     ),
     mins as (
       select m.minute_ts as ts, m.value, m.source_id, true as minute_channel
       from minute_stats m, bounds b
       where m.subject_id = $1 and m.type_id = $2
         and m.minute_ts >= b.from_ts and m.minute_ts < b.to_ts
       order by m.minute_ts desc
       limit $6
     )
     select u.ts, u.value, s.name, u.minute_channel
     from (select * from obs union all select * from mins) u
     join sources s on s.id = u.source_id
     order by u.ts desc
     limit $6`,
    [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone, limit]
  );
  return rows.map((r) => ({
    ts: r.ts,
    value: r.value,
    sourceName: r.name,
    minuteChannel: r.minute_channel,
  }));
}
