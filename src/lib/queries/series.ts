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
// counted. UTC-hour granularity is exactly the future rollup_hourly shape.
// Half-hour timezones: an UTC hour can straddle two local days there; the
// rollup phase will recompute edge hours from raw (architecture §4), this
// query-time version accepts the approximation (Europe/Paris is whole-hour).
// "No data != zero": days come from generate_series over DATES (a timestamptz
// series would drift on DST), missing buckets are null, never 0.
import { getDb } from '@/lib/db';
import { cached } from './cache';
import type { SubjectContext } from './context';
import { addDays, todayInZone, type DayRange } from './time';
import { getMetricType, type Aggregation } from './metric-types';
import { heavyRead } from './read';

export interface DailyPoint {
  day: string;
  value: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

export interface DailySeries {
  hkIdentifier: string;
  aggregation: Aggregation;
  unit: string | null;
  points: DailyPoint[];
}

interface SeriesRow {
  day: string;
  value: number | null;
  vmin: number | null;
  vmax: number | null;
  n: number;
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
      return "sum(extract(epoch from coalesce(o.end_ts, o.start_ts) - o.start_ts))";
    case 'none':
      throw new Error('metric has no aggregation');
  }
}

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
         count(*)::int as n
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2
    and o.start_ts >= b.from_ts and o.start_ts < b.to_ts
  group by 1
)
select days.day::text as day, agg.value, agg.vmin, agg.vmax, coalesce(agg.n, 0) as n
from days left join agg using (day)
order by days.day`;

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
  select date_trunc('hour', o.start_ts) as hour_utc, o.source_id, sum(o.value) as v
  from observations o, bounds b
  where o.subject_id = $1 and o.type_id = $2 and o.origin = 'health_xml'
    and o.start_ts >= b.from_ts and o.start_ts < least(b.to_ts, b.cutover_ts)
  group by 1, 2
),
raw_winner as (
  select distinct on (h.hour_utc) h.hour_utc as ts, h.v
  from raw_hourly h
  join sources s on s.id = h.source_id
  left join source_priorities p
    on p.subject_id = $1 and p.type_id = $2 and p.source_id = h.source_id
  order by h.hour_utc, p.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
),
minute as (
  select m.minute_ts as ts, m.value as v
  from minute_stats m, bounds b
  where m.subject_id = $1 and m.type_id = $2
    and m.minute_ts >= greatest(b.from_ts, b.cutover_ts) and m.minute_ts < b.to_ts
),
agg as (
  select (u.ts at time zone $5)::date as day, sum(u.v) as value, count(*)::int as n
  from (select ts, v from raw_winner union all select ts, v from minute) u
  group by 1
)
select days.day::text as day, agg.value,
       null::float8 as vmin, null::float8 as vmax, coalesce(agg.n, 0) as n
from days left join agg using (day)
order by days.day`;

export async function dailySeries(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange
): Promise<DailySeries> {
  const type = await getMetricType(hkIdentifier);
  if (type.kind !== 'quantity') {
    throw new Error(`dailySeries only handles quantity types, got ${hkIdentifier}`);
  }

  const params = [ctx.subjectId, type.id, range.fromDay, range.toDayExcl, ctx.timezone];
  const sql =
    type.haeRegime === 'minute_cumulative'
      ? CUMULATIVE_SQL
      : RAW_SQL(valueExpr(type.aggregation));
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
 * All-time series: the only read measured over the 500ms budget (1.0-1.4s
 * raw). The closed history [firstDay, today) is cached until local midnight,
 * today's tail is queried live (ms). The key embeds everything that changes
 * the result: subject, type, first data day, local day, and the channel
 * cutover (moving one invalidates the range). The cache dies with the
 * process and disappears entirely once rollups are built.
 */
export async function allTimeDailySeries(
  ctx: SubjectContext,
  hkIdentifier: string,
  firstDay: string
): Promise<DailySeries> {
  const today = todayInZone(ctx.timezone);
  if (firstDay >= today) {
    return dailySeries(ctx, hkIdentifier, { fromDay: firstDay, toDayExcl: addDays(today, 1) });
  }
  const type = await getMetricType(hkIdentifier);
  const { rows } = await getDb().query<{ cutover_ts: Date | null }>(
    `select cutover_ts from channel_cutovers where subject_id = $1 and type_id = $2`,
    [ctx.subjectId, type.id]
  );
  const cutoverKey = rows[0]?.cutover_ts?.getTime() ?? 'none';
  const key = `alltime:${ctx.subjectId}:${type.id}:${firstDay}:${today}:${cutoverKey}`;
  const history = await cached(key, 26 * 60 * 60_000, () =>
    dailySeries(ctx, hkIdentifier, { fromDay: firstDay, toDayExcl: today })
  );
  const tail = await dailySeries(ctx, hkIdentifier, { fromDay: today, toDayExcl: addDays(today, 1) });
  return { ...history, points: [...history.points, ...tail.points] };
}
