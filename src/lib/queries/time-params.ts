// URL <-> time window. The whole temporal state lives in the URL so server
// components stay stateless and views are shareable:
//   ?p=1m&a=2026-06-15   preset anchored on a day (chevron navigation)
//   ?from=...&to=...     custom inclusive range (no preset highlighted)
//   &compare=1           comparison overlay on
import {
  addDays,
  daysBetween,
  inclusiveToRange,
  isDay,
  isPreset,
  presetRange,
  type DayRange,
  type Preset,
} from './time';

export interface TimeState {
  preset: Preset | null;
  anchorDay: string;
  range: DayRange;
  compare: boolean;
}

export type TimeSearchParams = Record<string, string | string[] | undefined>;

const MAX_CUSTOM_DAYS = 15 * 366;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The keys parseTimeParams reads, and nothing else. */
const TIME_KEYS = ['p', 'a', 'from', 'to', 'compare'] as const;

/**
 * The time state of a search-param bag, re-serialised. Lets a link carry the
 * window the reader is looking at over to another screen without dragging that
 * screen's own state along (the explorer's ?m, a page number, a sport filter).
 */
export function timeQuery(sp: TimeSearchParams): string {
  const q = new URLSearchParams();
  for (const key of TIME_KEYS) {
    const v = one(sp[key]);
    if (v !== undefined && v !== '') q.set(key, v);
  }
  return q.toString();
}

export function parseTimeParams(
  sp: TimeSearchParams,
  today: string,
  firstDataDay: string | null
): TimeState {
  const compare = one(sp.compare) === '1';
  const from = one(sp.from);
  const to = one(sp.to);

  if (from && to && isDay(from) && isDay(to) && from <= to) {
    const range = inclusiveToRange(from, to);
    if (daysBetween(range.fromDay, range.toDayExcl) <= MAX_CUSTOM_DAYS) {
      return { preset: null, anchorDay: today, range, compare };
    }
  }

  const rawPreset = one(sp.p);
  // '1m' (the old calendar-month preset) falls through isPreset to the
  // default, so a bookmarked ?p=1m degrades to the nearly identical window.
  const preset: Preset = rawPreset && isPreset(rawPreset) ? rawPreset : '30d';
  const rawAnchor = one(sp.a);
  let anchorDay = rawAnchor && isDay(rawAnchor) ? rawAnchor : today;
  // An anchor in the future or absurdly old is a typo, not a view.
  if (anchorDay > today) anchorDay = today;
  if (firstDataDay && anchorDay < addDays(firstDataDay, -366)) anchorDay = today;

  return { preset, anchorDay, range: presetRange(preset, anchorDay, firstDataDay), compare };
}
