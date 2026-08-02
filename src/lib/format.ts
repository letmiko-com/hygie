// Locale-aware value formatting. Canonical units live in the database
// (architecture: kJ, km, count/min, ...); display conversion happens here
// and only here. Missing values render as the design system's absence glyph,
// never as 0 ("no data != zero").
import type { Locale } from '@/lib/i18n';

/** Absence glyph mandated by the design system (design/readme.md). */
export const ABSENT = '—';

const intlLocale = (locale: Locale) => (locale === 'fr' ? 'fr-FR' : 'en-GB');

export function fmtInt(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(value);
}

export function fmtNumber(value: number | null, locale: Locale, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** 7 243 812 -> "7,24 M" style compact figure. */
export function fmtCompact(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumSignificantDigits: 3,
  }).format(value);
}

export function fmtPercent(value: number | null, locale: Locale, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return ABSENT;
  return `${fmtNumber(value, locale, digits)} %`;
}

export function fmtBytes(bytes: number | null, locale: Locale): string {
  if (bytes === null || !Number.isFinite(bytes)) return ABSENT;
  if (bytes < 1024) return `${fmtInt(bytes, locale)} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${fmtNumber(v, locale, v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Workout duration: 52:18 or 2:14:32. */
export function fmtDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return ABSENT;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Long duration in hours: "7 h 24" (sleep, weekly volumes). */
export function fmtHoursMinutes(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return ABSENT;
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function fmtKm(meters: number | null, locale: Locale, digits = 1): string {
  if (meters === null || !Number.isFinite(meters)) return ABSENT;
  return `${fmtNumber(meters / 1000, locale, digits)} km`;
}

const KCAL_PER_KJ = 1 / 4.184;

export function kjToKcal(kj: number | null): number | null {
  return kj === null ? null : kj * KCAL_PER_KJ;
}

export function fmtKcalFromKj(kj: number | null, locale: Locale): string {
  const kcal = kjToKcal(kj);
  return kcal === null ? ABSENT : `${fmtInt(kcal, locale)} kcal`;
}

/** 'YYYY-MM-DD' local day -> localized date; the string carries no zone. */
export function fmtDay(
  day: string | null,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!day) return ABSENT;
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

export function fmtDateTime(date: Date | null, locale: Locale, timeZone: string): string {
  if (!date) return ABSENT;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** "4 min ago" / "il y a 4 min"; falls back to a date beyond 7 days. */
export function fmtRelative(date: Date | null, locale: Locale, timeZone: string): string {
  if (!date) return ABSENT;
  const deltaS = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(deltaS);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto', style: 'short' });
  if (abs < 60) return rtf.format(Math.round(deltaS), 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaS / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(deltaS / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(deltaS / 86_400), 'day');
  return fmtDateTime(date, locale, timeZone);
}
