// The catalogue read: EVERY metric type carrying data for this subject, with
// enough to decide whether to open it. It exists because the product only had
// screens for a handful of chosen metrics, so measures that were being
// recorded (hydration, for one) were simply unreachable. The promise of the
// catalogue is that nothing is hidden, which forbids any hard-coded list of
// types: the inventory is whatever the taxonomy plus the subject's own rows
// say it is.
//
// Three deliberate differences from queries/catalog.ts, which serves the
// explorer's metric picker:
//   - no filter on kind or aggregation. A category type (the *Event types,
//     MindfulSession, AppleStandHour) cannot be charted as a curve and is
//     still data the subject owns, so it is listed and gets an occurrence
//     rendering instead of a mean.
//   - no filter on `supported`. A type left unsupported carries no rows, so it
//     is excluded by the data probe anyway; keying visibility on the flag as
//     well would hide rows that DO exist after a promotion whose seed has not
//     re-run yet.
//   - a recent shape and a last value per type, which the picker does not need.
//
// Cost, measured on the dev database (7.2M observations, Europe/Paris):
//   - the presence probe is ~100 index probes on (subject_id, type_id, ts):
//     4.9 ms for the whole taxonomy, and it is what makes "list everything"
//     affordable at all. Never count to answer "does this exist".
//   - one 30-day daily series per present type, through dailySeries so the
//     numbers are the SAME code path as every chart (a second implementation
//     of the two-regime rule would drift): 70-80 ms wall for 37 types at
//     concurrency 6, and it scales linearly with the taxonomy.
// The result is cached 5 minutes per subject and local day. Short on purpose:
// this is the screen that claims completeness, so it must not be the screen
// that lags half an hour behind an ingest.
import { cached } from './cache';
import type { SubjectContext } from './context';
import { heavyRead } from './read';
import { getMetricType, type Aggregation, type HaeRegime } from './metric-types';
import { dailySeries } from './series';
import { addDays, daysBetween, type DayRange } from './time';
import { typeMeasureCounts } from './sync';

/**
 * Days of recent shape kept per type. A quarter, not a month: on the sparse
 * types (nutrition logged a few times a month, a weight now and then) thirty
 * days hold one or two points and the column reads as broken rather than as
 * sparse. Ninety days measures the same (176 ms against 152 ms for the whole
 * taxonomy) and shows a shape wherever there is one.
 */
export const SPARK_DAYS = 90;

/** Concurrency of the per-type series reads. Half the default pool, so the
 * catalogue can never starve the rest of a page it shares a request with. */
const FETCH_CONCURRENCY = 5;

export interface InventoryEntry {
  hkIdentifier: string;
  kind: 'quantity' | 'category';
  aggregation: Aggregation;
  haeRegime: HaeRegime;
  /** Canonical unit from the database; null for category types. */
  unit: string | null;
  /** Local day of the first and last row, both regimes considered. */
  firstDay: string;
  lastDay: string;
  /** Rows recorded for this subject (observations + minute_stats). */
  measures: number;
  /** Last SPARK_DAYS days up to lastDay, dense, null where nothing was measured. */
  recent: Array<number | null>;
  /** Value of the most recent day carrying a measure, and that day. */
  lastValue: number | null;
  lastValueDay: string | null;
  /** Days carrying a measure inside the recent window. */
  recentDaysMeasured: number;
}

interface ProbeRow {
  hk_identifier: string;
  kind: 'quantity' | 'category';
  aggregation: Aggregation;
  hae_regime: HaeRegime;
  unit_name: string | null;
  first_day: string;
  last_day: string;
}

/**
 * Presence and coverage bounds of every type, both storage regimes probed.
 * A minute_cumulative type ingested only through HAE has rows in minute_stats
 * and none in observations, so probing one table would silently drop it.
 */
const PROBE_SQL = `
with probe as (
  select t.hk_identifier, t.kind, t.aggregation, t.hae_regime, u.name as unit_name,
         (select min(o.start_ts) from observations o
          where o.subject_id = $1 and o.type_id = t.id) as obs_first,
         (select max(o.start_ts) from observations o
          where o.subject_id = $1 and o.type_id = t.id) as obs_last,
         (select min(m.minute_ts) from minute_stats m
          where m.subject_id = $1 and m.type_id = t.id) as min_first,
         (select max(m.minute_ts) from minute_stats m
          where m.subject_id = $1 and m.type_id = t.id) as min_last
  from metric_types t
  left join units u on u.id = t.canonical_unit_id
)
select hk_identifier, kind, aggregation, hae_regime, unit_name,
       ((least(coalesce(obs_first, 'infinity'::timestamptz),
               coalesce(min_first, 'infinity'::timestamptz)) at time zone $2)::date)::text as first_day,
       ((greatest(coalesce(obs_last, '-infinity'::timestamptz),
                  coalesce(min_last, '-infinity'::timestamptz)) at time zone $2)::date)::text as last_day
from probe
where obs_last is not null or min_last is not null
order by hk_identifier`;

/**
 * What a type with no reducible value says per day. Driven by the taxonomy:
 * a `duration` category (MindfulSession, sleep stages) occupies time and the
 * question is how much of it; a `none` category (the four *Event types,
 * AppleStandHour) is a point event and the only question is how many.
 */
export type OccurrenceMode = 'count' | 'duration';

export function occurrenceMode(aggregation: Aggregation): OccurrenceMode {
  return aggregation === 'duration' ? 'duration' : 'count';
}

// The ::float8 casts are load-bearing, not cosmetic: extract(epoch ...) and
// count() return numeric and bigint, which node-postgres hands back as
// STRINGS. A string reaching a formatter renders as the absence glyph, so a
// real 60-second session reads "no data" (seen, then fixed, on
// MindfulSession).
const OCCURRENCE_VALUE: Record<OccurrenceMode, string> = {
  count: 'count(*)::float8',
  duration: "sum(extract(epoch from coalesce(o.end_ts, o.start_ts) - o.start_ts))::float8",
};

const CATEGORY_DAYS_SQL = (value: string) => `
with days as (
  select d::date as day
  from generate_series($3::date, $4::date - 1, interval '1 day') d
),
agg as (
  select (o.start_ts at time zone $5)::date as day, ${value} as v
  from observations o
  where o.subject_id = $1 and o.type_id = $2
    and o.start_ts >= ($3::date::timestamp at time zone $5)
    and o.start_ts < ($4::date::timestamp at time zone $5)
  group by 1
)
select days.day::text as day, agg.v
from days left join agg using (day)
order by days.day`;

interface CategoryDayRow {
  day: string;
  v: number | null;
}

/**
 * Occurrences (or seconds) per local day of a type with no reducible value.
 * Dense axis, null and never zero on a day with nothing recorded. Exported
 * because the detail screen charts exactly this series.
 */
export async function categoryDaysPerDay(
  ctx: SubjectContext,
  typeId: number,
  range: DayRange,
  mode: OccurrenceMode = 'count'
): Promise<Array<number | null>> {
  const rows = await heavyRead<CategoryDayRow>(CATEGORY_DAYS_SQL(OCCURRENCE_VALUE[mode]), [
    ctx.subjectId,
    typeId,
    range.fromDay,
    range.toDayExcl,
    ctx.timezone,
  ]);
  return rows.map((r) => (r.v === null ? null : r.v));
}

/** Bounded-concurrency map. Keeps N reads in flight, never more. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

function lastMeasured(values: Array<number | null>, days: string[]): { value: number | null; day: string | null } {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null) return { value: v, day: days[i] ?? null };
  }
  return { value: null, day: null };
}

function daysOf(range: DayRange): string[] {
  const out: string[] = [];
  for (let d = range.fromDay; d < range.toDayExcl; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Full inventory for the catalogue screen. `today` is the subject's local day
 * and is only a cache key: the recent window of each type is anchored on THAT
 * type's last day, not on today, so a type that stopped recording in 2019
 * still shows the shape it had rather than a month of emptiness.
 */
export async function metricInventory(ctx: SubjectContext, today: string): Promise<InventoryEntry[]> {
  return cached(`inventory:${ctx.subjectId}:${today}`, 5 * 60_000, async () => {
    const [probe, counts] = await Promise.all([
      heavyRead<ProbeRow>(PROBE_SQL, [ctx.subjectId, ctx.timezone]),
      typeMeasureCounts(ctx),
    ]);

    return mapLimit(probe, FETCH_CONCURRENCY, async (row): Promise<InventoryEntry> => {
      const range: DayRange = {
        fromDay: addDays(row.last_day, -(SPARK_DAYS - 1)),
        toDayExcl: addDays(row.last_day, 1),
      };
      const days = daysOf(range);
      const chartable = row.kind === 'quantity' && row.aggregation !== 'none';
      let values: Array<number | null>;
      if (chartable) {
        // FORCED to the sources, not left to the width rule. The window is 90
        // days, which the rule would read from rollup_hourly, and a rollup that
        // nobody rebuilt after a bulk write is empty (series.ts says so). The
        // catalogue is the screen that claims completeness: it must not go
        // blank because an operational step was skipped, and it must not need
        // one either. Ninety days of sources is 176 ms for the whole taxonomy,
        // measured, so there is nothing to buy from the rollup here.
        const series = await dailySeries(ctx, row.hk_identifier, range, 'raw');
        values = series.points.map((p) => p.value);
      } else {
        const type = await getMetricType(row.hk_identifier);
        values = await categoryDaysPerDay(ctx, type.id, range, occurrenceMode(row.aggregation));
      }
      const last = lastMeasured(values, days);
      return {
        hkIdentifier: row.hk_identifier,
        kind: row.kind,
        aggregation: row.aggregation,
        haeRegime: row.hae_regime,
        unit: row.unit_name,
        firstDay: row.first_day,
        lastDay: row.last_day,
        measures: counts.get(row.hk_identifier) ?? 0,
        recent: values,
        lastValue: last.value,
        lastValueDay: last.day,
        recentDaysMeasured: values.filter((v) => v !== null).length,
      };
    });
  });
}

export interface InventorySummary {
  types: number;
  measures: number;
  firstDay: string | null;
  lastDay: string | null;
  /** Types whose last row is older than STALE_DAYS: recorded once, not anymore. */
  dormant: number;
}

/** Types silent for longer than this read as dormant rather than current. */
export const DORMANT_DAYS = 60;

export function summarize(entries: InventoryEntry[], today: string): InventorySummary {
  let measures = 0;
  let firstDay: string | null = null;
  let lastDay: string | null = null;
  let dormant = 0;
  for (const e of entries) {
    measures += e.measures;
    if (firstDay === null || e.firstDay < firstDay) firstDay = e.firstDay;
    if (lastDay === null || e.lastDay > lastDay) lastDay = e.lastDay;
    if (daysBetween(e.lastDay, today) > DORMANT_DAYS) dormant += 1;
  }
  return { types: entries.length, measures, firstDay, lastDay, dormant };
}

/**
 * Identifiers of every type the subject has data for. The detail screen
 * resolves its URL slug against this set: a type with no data for this
 * subject must 404 rather than render an empty page pretending it exists.
 */
export async function subjectTypeIdentifiers(
  ctx: SubjectContext,
  today: string
): Promise<Set<string>> {
  const entries = await metricInventory(ctx, today);
  return new Set(entries.map((e) => e.hkIdentifier));
}

