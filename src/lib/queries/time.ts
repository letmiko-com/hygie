// Pure local-day arithmetic on 'YYYY-MM-DD' strings. Every window is a
// half-open interval of whole local days [fromDay, toDayExcl) in the
// subject's timezone. UTC conversion happens in Postgres (AT TIME ZONE),
// never here: day strings go through Date.UTC, which involves no timezone,
// so no date library is needed.

export type Preset = '24h' | '7d' | '30d' | '6m' | '1y' | 'all';
export const PRESETS: readonly Preset[] = ['24h', '7d', '30d', '6m', '1y', 'all'];

export interface DayRange {
  fromDay: string;
  toDayExcl: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && fromUtcMs(ms) === value;
}

export function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

/** Current local day in an IANA zone. en-CA formats as YYYY-MM-DD. */
export function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/**
 * Local day of an instant in an IANA zone. Formatting, not arithmetic: the
 * zone database answers, we never compute an offset by hand.
 */
export function dayInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

function toUtcMs(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`invalid day: ${day}`);
  return ms;
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromUtcMs(toUtcMs(day) + n * 86_400_000);
}

/** Whole days from fromDay to toDay (positive when toDay is later). */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((toUtcMs(toDay) - toUtcMs(fromDay)) / 86_400_000);
}

/** Adds calendar months, clamping to the last day of the target month. */
export function addMonths(day: string, n: number): string {
  const d = new Date(toUtcMs(day));
  const targetMonth = d.getUTCMonth() + n;
  const target = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return fromUtcMs(target.getTime());
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function firstOfYear(day: string): string {
  return `${day.slice(0, 4)}-01-01`;
}

/**
 * Resolves a preset against an anchor day (usually today in the subject's
 * zone). 'all' needs the first day carrying data; a null firstDataDay
 * degrades to the anchor day alone.
 */
export function presetRange(preset: Preset, anchorDay: string, firstDataDay: string | null = null): DayRange {
  switch (preset) {
    case '24h':
      return { fromDay: anchorDay, toDayExcl: addDays(anchorDay, 1) };
    case '7d':
      return { fromDay: addDays(anchorDay, -6), toDayExcl: addDays(anchorDay, 1) };
    // Rolling 30 days, not the calendar month: the default view opens on it,
    // and a calendar month is mostly empty for most of the month. 30 stays
    // under the 31-day rollup threshold, so the default view is always fresh.
    case '30d':
      return { fromDay: addDays(anchorDay, -29), toDayExcl: addDays(anchorDay, 1) };
    case '6m': {
      const monthEnd = addMonths(firstOfMonth(anchorDay), 1);
      return { fromDay: addMonths(monthEnd, -6), toDayExcl: monthEnd };
    }
    case '1y': {
      const from = firstOfYear(anchorDay);
      return { fromDay: from, toDayExcl: addMonths(from, 12) };
    }
    case 'all':
      return { fromDay: firstDataDay ?? anchorDay, toDayExcl: addDays(anchorDay, 1) };
  }
}

/** Chevron navigation: shifts a resolved range by its own span. Null for 'all'. */
export function shiftRange(preset: Preset, range: DayRange, dir: -1 | 1): DayRange | null {
  switch (preset) {
    case 'all':
      return null;
    case '6m':
      return { fromDay: addMonths(range.fromDay, dir * 6), toDayExcl: addMonths(range.toDayExcl, dir * 6) };
    case '1y':
      return { fromDay: addMonths(range.fromDay, dir * 12), toDayExcl: addMonths(range.toDayExcl, dir * 12) };
    default: {
      const span = daysBetween(range.fromDay, range.toDayExcl);
      return { fromDay: addDays(range.fromDay, dir * span), toDayExcl: addDays(range.toDayExcl, dir * span) };
    }
  }
}

/**
 * Days of the range elapsed as of `today` (1..length). Trends compare the
 * elapsed prefix of the current window against the same prefix of the
 * previous one, otherwise "July so far vs full June" lies on every sum.
 */
export function elapsedDays(range: DayRange, today: string): number {
  const length = daysBetween(range.fromDay, range.toDayExcl);
  const elapsed = daysBetween(range.fromDay, addDays(today, 1));
  return Math.max(1, Math.min(length, elapsed));
}

/** Adjacent window of the same length ending where `range` starts, cut to `elapsed` days. */
export function previousRange(range: DayRange, elapsed?: number): DayRange {
  const length = daysBetween(range.fromDay, range.toDayExcl);
  const fromDay = addDays(range.fromDay, -length);
  const days = elapsed === undefined ? length : Math.max(1, Math.min(length, elapsed));
  return { fromDay, toDayExcl: addDays(fromDay, days) };
}

/**
 * Comparison window for a range. Calendar presets compare calendar to
 * calendar (July vs June, 2026 vs 2025) — that is what the labels promise;
 * the pro rata cut makes the unequal month lengths comparable. Custom ranges
 * and rolling presets fall back to the adjacent same-length window. Both
 * variants end exactly where `range` starts, which lets trends fetch one
 * combined series. Null preset = custom range.
 */
export function comparisonRange(preset: Preset | null, range: DayRange, elapsed?: number): DayRange {
  if (preset === '6m' || preset === '1y') {
    const prev = shiftRange(preset, range, -1) as DayRange;
    if (elapsed === undefined) return prev;
    const length = daysBetween(prev.fromDay, prev.toDayExcl);
    const days = Math.max(1, Math.min(length, elapsed));
    return { fromDay: prev.fromDay, toDayExcl: addDays(prev.fromDay, days) };
  }
  return previousRange(range, elapsed);
}

/** UI custom pickers are inclusive [from, to]; internals are half-open. */
export function inclusiveToRange(fromDay: string, toDayIncl: string): DayRange {
  return { fromDay, toDayExcl: addDays(toDayIncl, 1) };
}
