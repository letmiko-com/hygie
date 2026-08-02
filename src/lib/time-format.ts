// Human labels for day ranges. Client-safe (pure Intl, no server imports):
// TimeNav renders these labels in the browser.
import type { Locale } from '@/lib/i18n';
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

export function rangeLabel(preset: Preset | null, range: DayRange, locale: Locale): string {
  const last = lastDay(range);
  if (preset === '24h' || range.fromDay === last) {
    return fmt(range.fromDay, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (preset === '1m') {
    return fmt(range.fromDay, locale, { month: 'long', year: 'numeric' });
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
