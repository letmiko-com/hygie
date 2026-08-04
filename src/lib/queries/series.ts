// Daily series per metric, the core read pipeline. Implements the two-regime
// rule (architecture §2):
//   - raw_discrete: observations everywhere, aggregated per metric_types.aggregation.
//   - minute_cumulative: XML observations strictly BEFORE the channel cutover
//     (the XML export contains records past it — the filter is a correctness
//     invariant, not a precaution), minute_stats from the cutover on, both
//     summed into the same local-day bucket, so a day straddling the cutover
//     merges naturally.
// Pre-cutover dedup: one winning source per UTC hour (source_priorities rank,
// else the watch, else the higher value). Summing every source overcounts by
// ~80% on real data; a per-day winner loses the hours where only the phone
// counted. UTC-hour granularity is exactly the rollup_hourly shape. The group
// is really (UTC hour, local day): identical to the UTC hour alone wherever
// the zone offset is a whole number of hours, and the exact rule elsewhere
// (see edge 2 below).
// "No data != zero": days come from generate_series over DATES (a timestamptz
// series would drift on DST), missing buckets are null, never 0.
//
// ---------------------------------------------------------------------------
// SOURCE SELECTION: when a day is read from rollup_hourly, when from the sources
// ---------------------------------------------------------------------------
// Rollups exist only to make wide windows affordable (architecture §4): below
// the threshold the sources answer in tens of milliseconds and an extra table
// buys nothing. The rule is mechanical and depends on the WIDTH of the window,
// never on the screen asking:
//
//   width <= ROLLUP_MIN_DAYS  ->  sources only (observations / minute_stats)
//   width >  ROLLUP_MIN_DAYS  ->  rollup_hourly for the closed history,
//                                 sources for the two edges described below
//
// ROLLUP_MIN_DAYS is measured, see the constant. Both paths return the same
// numbers by construction: rollup_hourly is built by rollup_rebuild_range
// (migration 0002), which applies exactly the truth rules above, and a day is
// the sum of its whole UTC hours.
//
// Two edges are ALWAYS read from the sources, whatever the width:
//
//   1. TODAY, from local midnight in the subject's zone. A batch becomes
//      visible at 'normalized' and its rollup hours land at 'rollups_ready':
//      between the two the rollup is behind, by design. Today is where that
//      shows, and one day of raw is a few milliseconds, so today is never
//      served from the rollup.
//   2. THE TWO PARTIAL HOURS OF EACH LOCAL DAY, in a zone whose offset is not a
//      whole number of hours (India +5:30, Nepal +5:45, Chatham +12:45). There
//      the UTC hour containing local midnight belongs to two local days at
//      once and a rollup row cannot be cut in half, so that hour is read from
//      the sources on both sides of the midnight. In a whole-hour zone the set
//      is empty and the query degenerates to "rollup + today".
//      The sources-only path splits the same hour the same way (its dedup
//      group is (UTC hour, local day)), so a day does not change value when
//      the window it is looked at through crosses the threshold.
//
// Only 'sum' and 'average' can be rebuilt from a rollup hour (it carries n,
// sum, min and max): 'latest' and 'duration' stay on the sources whatever the
// width. No supported quantity type uses them today; the guard is there so
// that adding one cannot silently produce a wrong number.
//
// What the rule does NOT protect against: a rollup nobody rebuilt. Bulk writes
// that bypass the ingestion worker (XML backfill, hand-moved cutover) leave
// rollup_hourly untouched until `npm run rollups -- --subject <uuid>` runs
// (architecture §4). Skip it and wide windows show a history that stops where
// the last rebuild did, while narrow windows stay correct.
import type { SubjectContext } from './context';
import { addDays, daysBetween, todayInZone, type DayRange } from './time';
import { getMetricType, type Aggregation, type MetricTypeInfo } from './metric-types';
import { heavyRead } from './read';

export interface DailyPoint {
  day: string;
  value: number | null;
  min: number | null;
  max: number | null;
  /** Measured samples behind the bucket (merged contributions for cumulatives). */
  n: number;
}

export interface DailySeries {
  hkIdentifier: string;
  aggregation: Aggregation;
  unit: string | null;
  points: DailyPoint[];
}

/** Which side of the rule a read landed on. 'auto' applies the rule. */
export type SeriesSource = 'auto' | 'raw' | 'rollup';

interface SeriesRow {
  day: string;
  value: number | null;
  vmin: number | null;
  vmax: number | null;
  n: number;
}

/**
 * Widest window still read from the sources, in days.
 *
 * Measured on the dev database (7.2M observations, 473k rollup hours,
 * Europe/Paris), best of five runs, one window per width anchored on the end
 * of the data:
 *
 *   width      HR raw   HR rollup   steps raw   steps rollup
 *     21 d      10.8 ms     8.0 ms      7.1 ms        8.3 ms
 *     31 d      10.1 ms     6.4 ms     10.4 ms       10.4 ms
 *     90 d      30.1 ms     6.6 ms     17.6 ms       15.2 ms
 *    365 d     222.2 ms    13.0 ms     54.1 ms       15.6 ms
 *   all-time  1160.5 ms    93.3 ms    463.4 ms       70.1 ms
 *
 * Heart rate (average over 2.06M samples) crosses around two weeks, step count
 * (sum, cumulative, four channels to merge) around a month. Thirty-one days
 * takes the later of the two crossings: below it the rollup would win a few
 * milliseconds on a query that was already free, above it the gap grows
 * without bound. It also leaves every calendar-month view — the narrowest
 * window a user can hold open for a long time — on the path that needs no
 * rollup to be fresh. It is a plateau, not a cliff: 21 or 45 measure the same.
 *
 * The rule is deliberately blind to how dense a series is, and that costs
 * something on the sparse ones: resting heart rate (one value a day) is read
 * all-time in 18.7 ms from the sources and 37.9 ms from the rollup, because
 * the bigger query plans for longer than the scan it saves. Both are two
 * orders of magnitude inside the 500 ms budget, and the alternative — a
 * per-type density statistic to keep up to date — buys 19 ms.
 */
export const ROLLUP_MIN_DAYS = 31;

/** Aggregations a rollup hour can be reduced back into. */
const ROLLUP_AGGREGATIONS: ReadonlySet<Aggregation> = new Set<Aggregation>(['sum', 'average']);

/**
 * Applies the source-selection rule. Exported so that the comparison harness
 * and an operator chasing a rollup discrepancy can name what they measured.
 */
export function seriesSource(type: MetricTypeInfo, range: DayRange): 'raw' | 'rollup' {
  if (!ROLLUP_AGGREGATIONS.has(type.aggregation)) return 'raw';
  return daysBetween(range.fromDay, range.toDayExcl) > ROLLUP_MIN_DAYS ? 'rollup' : 'raw';
}

/**
 * SQL reducer for one bucket of a raw_discrete metric. Exported so the
 * explorer's hour/minute buckets stay strictly the same reduction as the
 * daily series: two implementations would drift.
 */
export function valueExpr(aggregation: Aggregation): string {
  switch (aggregation) {
    case 'sum':
      return 'sum(o.value)';
    case 'average':
      return 'avg(o.value)';
    case 'latest':
      return '(array_agg(o.value order by o.start_ts desc))[1]';
    case 'duration':
      // ::float8 because extract(epoch ...) is numeric, which node-postgres
      // returns as a string: it would flow all the way to a formatter and
      // render as an absence.
      return "sum(extract(epoch from coalesce(o.end_ts, o.start_ts) - o.start_ts))::float8";
    case 'none':
      throw new Error('metric has no aggregation');
  }
}

// --- reading the sources -----------------------------------------------------

// n counts MEASURED samples: a row with a null value is not a measure, and
// avg() already ignores it. Counting it would also be the one figure the
// rollup cannot reproduce (rollup_rebuild_range filters nulls out).
const RAW_SQL = (agg: string) => `
with bounds as (
  select ($3::date::timestamp at time zone $5) as from_ts,
         ($4::date::timestamp at time zone $5) as to_ts
),
days as (
  select d::date as day
  from generate_series($3::date, $4::date - 1, interval '1 day') d
),
agg as (
  select (o.start_ts at time zone $5)::date as day,
         ${agg} as value,
         min(o.value) as vmin,
         max(o.value) as vmax,
         count(o.value)::int as n
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2
    and o.start_ts >= b.from_ts and o.start_ts < b.to_ts
  group by 1
)
select days.day::text as day, agg.value, agg.vmin, agg.vmax, coalesce(agg.n, 0) as n
from days left join agg using (day)
order by days.day`;

// The pre-cutover dedup group is (UTC hour, local day), not the UTC hour
// alone. The two are the same thing in a whole-hour zone; where they differ,
// the pair is what keeps this path and the rollup path on the same answer, and
// it is the "two partial hours from raw" rule of architecture 4 applied at the
// only place it can be applied — a rollup row cannot be cut in half.
const CUMULATIVE_SQL = `
with bounds as (
  select ($3::date::timestamp at time zone $5) as from_ts,
         ($4::date::timestamp at time zone $5) as to_ts,
         coalesce((select c.cutover_ts from channel_cutovers c
                   where c.subject_id = $1 and c.type_id = $2),
                  'infinity'::timestamptz) as cutover_ts
),
days as (
  select d::date as day
  from generate_series($3::date, $4::date - 1, interval '1 day') d
),
raw_hourly as (
  select date_trunc('hour', o.start_ts) as hour_utc,
         (o.start_ts at time zone $5)::date as day,
         o.source_id, sum(o.value) as v
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2 and o.origin = 'health_xml'
    and o.value is not null
    and o.start_ts >= b.from_ts and o.start_ts < least(b.to_ts, b.cutover_ts)
  group by 1, 2, 3
),
raw_winner as (
  select distinct on (h.hour_utc, h.day) h.day, h.v
  from raw_hourly h
  join sources s on s.id = h.source_id
  left join source_priorities p
    on p.subject_id = $1 and p.type_id = $2 and p.source_id = h.source_id
  order by h.hour_utc, h.day, p.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
),
minute as (
  select (m.minute_ts at time zone $5)::date as day, m.value as v
  from minute_stats m, bounds b
  where m.subject_id = $1 and m.type_id = $2
    and m.minute_ts >= greatest(b.from_ts, b.cutover_ts) and m.minute_ts < b.to_ts
),
agg as (
  select u.day, sum(u.v) as value, count(*)::int as n
  from (select day, v from raw_winner union all select day, v from minute) u
  group by 1
)
select days.day::text as day, agg.value,
       null::float8 as vmin, null::float8 as vmax, coalesce(agg.n, 0) as n
from days left join agg using (day)
order by days.day`;

// --- reading the rollup ------------------------------------------------------

// Shared head of both rollup queries. $6 is today in the subject's zone.
//   live_from : local midnight today, clamped inside the window. Everything
//               from there on is read from the sources (edge 1 of the rule).
//   split_hours / edges : the UTC hour straddling a local midnight, and the two
//               pieces it must be cut into (edge 2). Both are empty in a
//               whole-hour zone, which is what makes this cost nothing there.
const ROLLUP_HEAD = `
bounds as (
  select ($3::date::timestamp at time zone $5) as from_ts,
         ($4::date::timestamp at time zone $5) as to_ts,
         least(($4::date::timestamp at time zone $5),
               greatest(($3::date::timestamp at time zone $5),
                        ($6::date::timestamp at time zone $5))) as live_from
),
days as (
  select d::date as day
  from generate_series($3::date, $4::date - 1, interval '1 day') d
),
midnights as (
  select (d::date::timestamp at time zone $5) as t
  from generate_series($3::date, $4::date, interval '1 day') d
),
split_hours as (
  select distinct date_trunc('hour', m.t) as h
  from midnights m
  where date_trunc('hour', m.t) <> m.t
),
edges as (
  select iv_from, iv_to from (
    select greatest(date_trunc('hour', m.t), b.from_ts) as iv_from,
           least(m.t, b.live_from) as iv_to
    from midnights m, bounds b
    where date_trunc('hour', m.t) <> m.t
    union all
    select greatest(m.t, b.from_ts),
           least(date_trunc('hour', m.t) + interval '1 hour', b.live_from)
    from midnights m, bounds b
    where date_trunc('hour', m.t) <> m.t
  ) x
  where iv_to > iv_from
)`;

// Whole UTC hours of the closed history, minus the ones a local midnight cuts.
// The primary key (subject_id, type_id, hour_utc) is exactly this access path.
// Both bounds are written against the bare column, never `hour_utc + 1 hour`:
// an expression there is not an index bound, and the scan then runs to the end
// of the series before filtering (measured: 70 ms instead of 2 ms on a
// forty-day window at the start of a fourteen-year history).
const ROLLUP_HOURS = `
roll as (
  select (r.hour_utc at time zone $5)::date as day,
         sum(r.sum) as s, sum(r.n)::bigint as n,
         min(r.min) as vmin, max(r.max) as vmax
  from rollup_hourly r, bounds b
  where r.subject_id = $1 and r.type_id = $2
    and r.hour_utc >= b.from_ts
    and r.hour_utc <= b.live_from - interval '1 hour'
    and not exists (select 1 from split_hours s where s.h = r.hour_utc)
  group by 1
)`;

// A sum is the sum of the hourly sums; an average is the total over the sample
// count, never the mean of the hourly means (an hour with two samples must not
// weigh as much as an hour with sixty).
function rollupValueExpr(aggregation: Aggregation): string {
  return aggregation === 'sum'
    ? 'merged.s'
    : '(case when merged.n > 0 then merged.s / merged.n end)';
}

const ROLLUP_DISCRETE_SQL = (aggregation: Aggregation) => `
with ${ROLLUP_HEAD},
${ROLLUP_HOURS},
-- Sources for today and for the partial hours: a plain aggregate, identical to
-- RAW_SQL restricted to those intervals. LATERAL is load-bearing, not style:
-- a plain join lets the planner drive the loop from observations and turn the
-- interval bounds into a filter, which scans the whole series to match an
-- interval set that is usually a single day (measured: 63 ms of pure waste).
raw_part as (
  select x.day, sum(x.s) as s, sum(x.n) as n, min(x.vmin) as vmin, max(x.vmax) as vmax
  from (select iv_from, iv_to from edges
        union all
        select b.live_from, b.to_ts from bounds b where b.to_ts > b.live_from) iv
  cross join lateral (
    select (o.start_ts at time zone $5)::date as day,
           sum(o.value) as s, count(o.value)::bigint as n,
           min(o.value) as vmin, max(o.value) as vmax
    from observations o
    where o.subject_id = $1 and o.type_id = $2
      and o.start_ts >= iv.iv_from and o.start_ts < iv.iv_to
    group by 1
  ) x
  group by x.day
),
merged as (
  select u.day, sum(u.s) as s, sum(u.n) as n, min(u.vmin) as vmin, max(u.vmax) as vmax
  from (select * from roll union all select * from raw_part) u
  group by u.day
)
select days.day::text as day,
       ${rollupValueExpr(aggregation)} as value,
       merged.vmin, merged.vmax, coalesce(merged.n, 0)::int as n
from days left join merged using (day)
order by days.day`;

// Cumulatives: the rollup already merged "one winning source per UTC hour
// before the cutover" with "minute_stats from the cutover on". The sources are
// re-read twice here, with the two different dedup grains the rule prescribes:
//   - edge pieces: one winner per PIECE, because the piece is what belongs to
//     the local day (this is the half-hour-timezone exactness of §4);
//   - live tail: one winner per UTC HOUR, which is what the sources-only path
//     does, so today reads the same both sides of the threshold.
const ROLLUP_CUMULATIVE_SQL = `
with ${ROLLUP_HEAD},
cut as (
  select coalesce((select c.cutover_ts from channel_cutovers c
                   where c.subject_id = $1 and c.type_id = $2),
                  'infinity'::timestamptz) as cutover_ts
),
${ROLLUP_HOURS},
-- LATERAL for the same reason as in the discrete query: the interval set is
-- tiny (empty in a whole-hour zone) and must drive the index, not be filtered
-- against a full scan of the series.
edge_src as (
  select e.iv_from, x.source_id, x.v
  from edges e
  cross join cut c
  cross join lateral (
    select o.source_id, sum(o.value) as v
    from observations o
    where o.subject_id = $1 and o.type_id = $2 and o.origin = 'health_xml'
      and o.value is not null
      and o.start_ts >= e.iv_from and o.start_ts < least(e.iv_to, c.cutover_ts)
    group by o.source_id
  ) x
),
edge_winner as (
  select distinct on (h.iv_from) (h.iv_from at time zone $5)::date as day, h.v
  from edge_src h
  join sources s on s.id = h.source_id
  left join source_priorities p
    on p.subject_id = $1 and p.type_id = $2 and p.source_id = h.source_id
  order by h.iv_from, p.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
),
edge_minute as (
  select x.day, x.v
  from edges e
  cross join cut c
  cross join lateral (
    select (m.minute_ts at time zone $5)::date as day, m.value as v
    from minute_stats m
    where m.subject_id = $1 and m.type_id = $2
      and m.minute_ts >= greatest(e.iv_from, c.cutover_ts) and m.minute_ts < e.iv_to
  ) x
),
live_src as (
  select date_trunc('hour', o.start_ts) as hour_utc,
         (o.start_ts at time zone $5)::date as day,
         o.source_id, sum(o.value) as v
  from observations o, bounds b, cut c
  where o.subject_id = $1 and o.type_id = $2 and o.origin = 'health_xml'
    and o.value is not null
    and o.start_ts >= b.live_from and o.start_ts < least(b.to_ts, c.cutover_ts)
  group by 1, 2, 3
),
live_winner as (
  select distinct on (h.hour_utc, h.day) h.day, h.v
  from live_src h
  join sources s on s.id = h.source_id
  left join source_priorities p
    on p.subject_id = $1 and p.type_id = $2 and p.source_id = h.source_id
  order by h.hour_utc, h.day, p.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
),
live_minute as (
  select (m.minute_ts at time zone $5)::date as day, m.value as v
  from minute_stats m, bounds b, cut c
  where m.subject_id = $1 and m.type_id = $2
    and m.minute_ts >= greatest(b.live_from, c.cutover_ts) and m.minute_ts < b.to_ts
),
raw_part as (
  select u.day, sum(u.v) as s, count(*)::bigint as n
  from (select day, v from edge_winner
        union all select day, v from edge_minute
        union all select day, v from live_winner
        union all select day, v from live_minute) u
  group by 1
),
merged as (
  select u.day, sum(u.s) as s, sum(u.n) as n
  from (select day, s, n from roll union all select day, s, n from raw_part) u
  group by u.day
)
select days.day::text as day, merged.s as value,
       null::float8 as vmin, null::float8 as vmax, coalesce(merged.n, 0)::int as n
from days left join merged using (day)
order by days.day`;

// --- entry points ------------------------------------------------------------

export async function dailySeries(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  source: SeriesSource = 'auto'
): Promise<DailySeries> {
  const type = await getMetricType(hkIdentifier);
  if (type.kind !== 'quantity') {
    throw new Error(`dailySeries only handles quantity types, got ${hkIdentifier}`);
  }
  const cumulative = type.haeRegime === 'minute_cumulative';
  const from = source === 'auto' ? seriesSource(type, range) : source;
  if (from === 'rollup' && !ROLLUP_AGGREGATIONS.has(type.aggregation)) {
    throw new Error(`${type.aggregation} cannot be read from rollup_hourly`);
  }

  const params: unknown[] = [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone];
  let sql: string;
  if (from === 'rollup') {
    params.push(todayInZone(ctx.timezone));
    sql = cumulative ? ROLLUP_CUMULATIVE_SQL : ROLLUP_DISCRETE_SQL(type.aggregation);
  } else {
    sql = cumulative ? CUMULATIVE_SQL : RAW_SQL(valueExpr(type.aggregation));
  }
  const rows = await heavyRead<SeriesRow>(sql, params);

  return {
    hkIdentifier,
    aggregation: type.aggregation,
    unit: type.canonicalUnit,
    points: rows.map((r) => ({
      day: r.day,
      value: r.value,
      min: r.vmin,
      max: r.vmax,
      n: r.n,
    })),
  };
}

/**
 * All-time series, from the first day carrying data to today included. Used to
 * be the one read over the 500ms budget and the reason a memory cache existed;
 * it is now a plain dailySeries call, well inside the budget, and its closed
 * history comes from the rollup while today keeps coming from the sources.
 */
export async function allTimeDailySeries(
  ctx: SubjectContext,
  hkIdentifier: string,
  firstDay: string
): Promise<DailySeries> {
  const today = todayInZone(ctx.timezone);
  const toDayExcl = addDays(firstDay > today ? firstDay : today, 1);
  return dailySeries(ctx, hkIdentifier, { fromDay: firstDay, toDayExcl });
}
