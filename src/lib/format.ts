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

/** Pace from seconds per km: "4:52 /km". */
export function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return ABSENT;
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

export interface MetricWriter {
  /** Unit written after a value; null when dimensionless or self-describing. */
  unit: string | null;
  /** Canonical -> display conversion. Charts plot converted values. */
  convert: (v: number) => number;
  /** Writes a CANONICAL value: converts, formats, appends the unit. */
  write: (v: number | null) => string | null;
  /** Writes an ALREADY-CONVERTED value, for chart labels and tooltips. */
  writeDisplay: (v: number | null) => string | null;
}

/**
 * Value writer for one metric type. Everything a screen needs to print a
 * figure of that type: the canonical-to-display conversion, the precision its
 * magnitude deserves, and the unit after it. Null in, absence glyph out.
 *
 * `magnitude` is given in CANONICAL units (the largest absolute value the
 * screen will print) and converted here, which is the only order that works:
 * the precision depends on the displayed magnitude, and the conversion is what
 * produces it.
 *
 * A `duration` aggregation carries seconds and reads as "1 h 12". Printing
 * 4 320 with no unit, or "4 320 s", would be technically true and useless.
 */
export function metricWriter(
  aggregation: string,
  canonicalUnit: string | null,
  magnitude: number,
  locale: Locale
): MetricWriter {
  if (aggregation === 'duration') {
    const write = (v: number | null) => (v === null ? null : fmtHoursMinutes(v));
    return { unit: null, convert: (v) => v, write, writeDisplay: write };
  }
  // 'none' means "not reducible": what a screen shows for such a type is a
  // count of occurrences, and half an alert does not exist.
  if (aggregation === 'none') {
    const write = (v: number | null) => (v === null ? null : fmtInt(v, locale));
    return { unit: null, convert: (v) => v, write, writeDisplay: write };
  }
  const display = displayUnit(canonicalUnit);
  const format = magnitudeFormat(Math.abs(display.convert(magnitude)), locale);
  const writeDisplay = (v: number | null): string | null => {
    if (v === null) return null;
    const written = format(v);
    return display.unit === null ? written : `${written} ${display.unit}`;
  };
  return {
    unit: display.unit,
    convert: display.convert,
    write: (v) => (v === null ? null : writeDisplay(display.convert(v))),
    writeDisplay,
  };
}

export interface UnitDisplay {
  /** Unit as written next to a value; null when the quantity is dimensionless. */
  unit: string | null;
  convert: (v: number) => number;
}

/**
 * Canonical unit (database) -> display unit (UI). The architecture keeps one
 * canonical unit per type in Postgres and leaves presentation to the UI, so
 * this table is the single place the two vocabularies meet: energy is stored
 * in kJ and read in kcal everywhere, `count` is not a unit but the absence of
 * one, and HealthKit's ASCII compounds (`km/hr`, `mL/min·kg`) are written the
 * way a French or English reader expects.
 *
 * An unknown unit passes through unchanged: a type promoted tomorrow with a
 * unit nobody mapped still displays its real unit, never a blank.
 */
export function displayUnit(unit: string | null): UnitDisplay {
  switch (unit) {
    case 'kJ':
      return { unit: 'kcal', convert: (v) => v * KCAL_PER_KJ };
    case 'count':
      return { unit: null, convert: (v) => v };
    case 'appleEffortScore':
      return { unit: null, convert: (v) => v };
    case 'count/min':
      return { unit: '/min', convert: (v) => v };
    case 'km/hr':
      return { unit: 'km/h', convert: (v) => v };
    case 'degC':
      return { unit: '°C', convert: (v) => v };
    case 'dBASPL':
      return { unit: 'dB', convert: (v) => v };
    case 'mcg':
      return { unit: 'µg', convert: (v) => v };
    case 'hr':
      return { unit: 'h', convert: (v) => v };
    case 'mL/min·kg':
      return { unit: 'mL/min/kg', convert: (v) => v };
    case 'kcal/hr·kg':
      return { unit: 'kcal/h/kg', convert: (v) => v };
    default:
      return { unit, convert: (v) => v };
  }
}

/**
 * Formatter picked from the magnitude of what it will print: four significant
 * digits, never more. A step count must not read "12 483,00" and a wrist
 * temperature must not read "36".
 */
export function magnitudeFormat(maxAbs: number, locale: Locale): (v: number) => string {
  if (maxAbs >= 1000) return (v) => fmtInt(v, locale);
  if (maxAbs >= 100) return (v) => fmtNumber(v, locale, 0);
  if (maxAbs >= 10) return (v) => fmtNumber(v, locale, 1);
  return (v) => fmtNumber(v, locale, 2);
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

/**
 * `withYear` is not decoration: on a screen whose window is arbitrary, an
 * all-time table of timestamps printed "18 janv., 23:13" for a row from 2024
 * and one from 2016. Screens with a bounded window (a session) keep the short
 * form, which is why this is a flag and not a change of default.
 */
export function fmtDateTime(
  date: Date | null,
  locale: Locale,
  timeZone: string,
  withYear = false
): string {
  if (!date) return ABSENT;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
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
