// Period trend: current window vs the adjacent previous window, computed
// from the SAME daily-series pipeline (one SQL round trip over the combined
// range, reduced here). A separate FILTER query would duplicate the whole
// cumulative dedup pipeline and inevitably diverge from the series.
// An incomplete current period is compared pro rata of elapsed days,
// otherwise "July so far vs full June" lies on every sum.
// "No data != zero": a window with no data yields null, and deltaPct is null
// whenever either side is missing (or the reference is 0).
import type { SubjectContext } from './context';
import { dailySeries, type DailyPoint } from './series';
import {
  comparisonRange,
  daysBetween,
  elapsedDays,
  todayInZone,
  type DayRange,
  type Preset,
} from './time';

export interface Trend {
  current: number | null;
  previous: number | null;
  /** Percent change vs previous; null when either window has no data. */
  deltaPct: number | null;
  currentDays: number;
  previousDays: number;
}

/** Reduces day points to one figure: total for sums, mean of day values otherwise. */
function reduce(points: DailyPoint[], mode: 'sum' | 'mean'): number | null {
  let acc = 0;
  let n = 0;
  for (const p of points) {
    if (p.value === null) continue;
    acc += p.value;
    n += 1;
  }
  if (n === 0) return null;
  return mode === 'sum' ? acc : acc / n;
}

export async function periodTrend(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  preset: Preset | null = null
): Promise<Trend> {
  return (await seriesWithTrend(ctx, hkIdentifier, range, preset)).trend;
}

/**
 * Series + trend for one metric in one round trip: the combined range is
 * fetched once, the visible window is sliced out of it. This is what the
 * dashboard cards consume (sparkline + delta).
 */
export async function seriesWithTrend(
  ctx: SubjectContext,
  hkIdentifier: string,
  range: DayRange,
  preset: Preset | null = null
): Promise<{ points: DailyPoint[]; trend: Trend; unit: string | null }> {
  const today = todayInZone(ctx.timezone);
  const elapsed = elapsedDays(range, today);
  const prev = comparisonRange(preset, range, elapsed);

  const combined: DayRange = { fromDay: prev.fromDay, toDayExcl: range.toDayExcl };
  const series = await dailySeries(ctx, hkIdentifier, combined);

  const prevLen = daysBetween(prev.fromDay, prev.toDayExcl);
  const curOffset = daysBetween(prev.fromDay, range.fromDay);
  const prevPoints = series.points.slice(0, prevLen);
  const curPoints = series.points.slice(curOffset);
  const curElapsedPoints = series.points.slice(curOffset, curOffset + elapsed);

  const mode = series.aggregation === 'sum' || series.aggregation === 'duration' ? 'sum' : 'mean';
  const current = reduce(curElapsedPoints, mode);
  const previous = reduce(prevPoints, mode);

  return {
    points: curPoints,
    unit: series.unit,
    trend: {
      current,
      previous,
      deltaPct:
        current === null || previous === null || previous === 0
          ? null
          : ((current - previous) / Math.abs(previous)) * 100,
      currentDays: elapsed,
      previousDays: prevLen,
    },
  };
}

