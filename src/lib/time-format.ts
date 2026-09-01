// Human labels for day ranges. Client-safe (pure Intl, no server imports):
// TimeNav renders these labels in the browser.
import type { Locale } from '@/lib/i18n';
import type { Granularity } from '@/lib/queries/explore';
import type { DayRange, Preset } from '@/lib/queries/time';

const intlLocale = (locale: Locale) => (locale === 'fr' ? 'fr-FR' : 'en-GB');

function d(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function fmt(day: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' }).format(d(day));
}

/** Last day INSIDE the half-open range. */
function lastDay(range: DayRange): string {
  const t = d(range.toDayExcl).getTime() - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Evenly spaced labels for a day axis, never more than the axis has days:
 * a one-day window printed "3 août" in all five slots, which says nothing
 * about the axis and reads as five distinct dates.
 */
export function dayAxisLabels(
  days: string[],
  locale: Locale,
  slots: number,
  options: Intl.DateTimeFormatOptions
): string[] {
  if (days.length === 0 || slots < 1) return [];
  const count = Math.min(slots, days.length);
  const last = days.length - 1;
  const indexes =
    count === 1 ? [last] : Array.from({ length: count }, (_, i) => Math.round((i / (count - 1)) * last));
  return [...new Set(indexes)].map((i) => fmt(days[i], locale, options));
}

export function rangeLabel(preset: Preset | null, range: DayRange, locale: Locale): string {
  const last = lastDay(range);
  if (preset === '24h' || range.fromDay === last) {
    return fmt(range.fromDay, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (preset === '1y' && range.fromDay.endsWith('-01-01')) {
    return range.fromDay.slice(0, 4);
  }
  const sameYear = range.fromDay.slice(0, 4) === last.slice(0, 4);
  const from = fmt(range.fromDay, locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  const to = fmt(last, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${from} → ${to}`;
}

export function comparisonLabel(prev: DayRange, locale: Locale, vsWord: string): string {
  const last = lastDay(prev);
  const sameMonth = prev.fromDay.slice(0, 7) === last.slice(0, 7);
  if (sameMonth && prev.fromDay.endsWith('-01')) {
    return `${vsWord} ${fmt(prev.fromDay, locale, { month: 'short', year: 'numeric' })}`;
  }
  return `${vsWord} ${fmt(prev.fromDay, locale, { day: 'numeric', month: 'short' })} → ${fmt(last, locale, { day: 'numeric', month: 'short' })}`;
}

/**
 * Five evenly spaced labels for a dense bucket axis (hour and minute grains,
 * one bucket per grain from the first instant). Labels sit on BUCKET
 * BOUNDARIES, not on the nearest bucket start: the slot at 75 % of a
 * 1440-minute day is the boundary between 17:59 and 18:00, and an axis
 * graduated "17:59" reads as an off-by-one. The last label is therefore the
 * end of the window (00:00 of the next day for one day at minute grain), the
 * usual convention for a time axis. A window cut at "now" has a span that is
 * not a multiple of four grains and gets non-round labels: that is the window.
 */
export function bucketAxisLabels(
  buckets: Date[],
  granularity: Granularity,
  locale: Locale,
  timeZone: string
): string[] {
  if (buckets.length === 0) return [];
  const grainMs = granularity === 'minute' ? 60_000 : 3_600_000;
  const start = buckets[0].getTime();
  const span = buckets.length * grainMs;
  const options: Intl.DateTimeFormatOptions =
    granularity === 'minute'
      ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }
      : { day: 'numeric', month: 'short', hour: '2-digit', hour12: false, timeZone };
  const format = new Intl.DateTimeFormat(intlLocale(locale), options);
  return [0, 0.25, 0.5, 0.75, 1].map((f) => format.format(new Date(start + Math.round(f * span))));
}
