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

/**
 * The account's unit system (users.unit_system). Conversion is display only:
 * the database keeps its canonical units (km, m, kg, degC...), and every
 * function below that prints a quantity takes the system explicitly, so a
 * screen cannot forget it without the compiler noticing.
 */
export type UnitSystem = 'metric' | 'imperial';

const M_PER_MI = 1609.344;
const MI_PER_KM = 1000 / M_PER_MI;
const FT_PER_M = 1 / 0.3048;
const IN_PER_CM = 1 / 2.54;
const LB_PER_KG = 1 / 0.45359237;
const FLOZ_PER_ML = 1 / 29.5735295625;

/** Unit of a long distance: kilometres or miles. */
export function distanceUnit(system: UnitSystem): 'km' | 'mi' {
  return system === 'imperial' ? 'mi' : 'km';
}

/** Meters (canonical for workouts) to the long-distance unit of the system. */
export function metersToDistance(meters: number, system: UnitSystem): number {
  return system === 'imperial' ? meters / M_PER_MI : meters / 1000;
}

/** Length of one split, in meters: a kilometre or a mile. */
export function splitMeters(system: UnitSystem): number {
  return system === 'imperial' ? M_PER_MI : 1000;
}

export function fmtDistance(meters: number | null, locale: Locale, system: UnitSystem, digits = 1): string {
  if (meters === null || !Number.isFinite(meters)) return ABSENT;
  return `${fmtNumber(metersToDistance(meters, system), locale, digits)} ${distanceUnit(system)}`;
}

/** Unit of a speed: km/h or mph. */
export function speedUnit(system: UnitSystem): string {
  return system === 'imperial' ? 'mph' : 'km/h';
}

/** km/h (canonical for speeds) to the speed unit of the system. */
export function kmhToSpeed(kmh: number, system: UnitSystem): number {
  return system === 'imperial' ? kmh * MI_PER_KM : kmh;
}

export function fmtSpeed(kmh: number | null, locale: Locale, system: UnitSystem): string {
  if (kmh === null || !Number.isFinite(kmh)) return ABSENT;
  return `${fmtNumber(kmhToSpeed(kmh, system), locale, 1)} ${speedUnit(system)}`;
}

/** Unit of a height difference or short length: meters or feet. */
export function elevationUnit(system: UnitSystem): 'm' | 'ft' {
  return system === 'imperial' ? 'ft' : 'm';
}

export function metersToElevation(meters: number, system: UnitSystem): number {
  return system === 'imperial' ? meters * FT_PER_M : meters;
}

export function fmtElevation(meters: number | null, locale: Locale, system: UnitSystem): string {
  if (meters === null || !Number.isFinite(meters)) return ABSENT;
  return `${fmtInt(metersToElevation(meters, system), locale)} ${elevationUnit(system)}`;
}

const KCAL_PER_KJ = 1 / 4.184;

export function kjToKcal(kj: number | null): number | null {
  return kj === null ? null : kj * KCAL_PER_KJ;
}

export function fmtKcalFromKj(kj: number | null, locale: Locale): string {
  const kcal = kjToKcal(kj);
  return kcal === null ? ABSENT : `${fmtInt(kcal, locale)} kcal`;
}

/** Seconds per km (canonical pace) to seconds per km or per mile. */
export function paceToSystem(secPerKm: number, system: UnitSystem): number {
  return system === 'imperial' ? secPerKm * (M_PER_MI / 1000) : secPerKm;
}

/** Unit of a pace: "/km" or "/mi". */
export function paceUnit(system: UnitSystem): string {
  return `/${distanceUnit(system)}`;
}

/** Minutes and seconds of an already converted pace: "4:52". */
export function fmtPaceClock(secPerUnit: number): string {
  const s = Math.round(secPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Pace from seconds per km: "4:52 /km", or "7:50 /mi" in imperial. */
export function fmtPace(secPerKm: number | null, system: UnitSystem): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return ABSENT;
  return `${fmtPaceClock(paceToSystem(secPerKm, system))} ${paceUnit(system)}`;
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
  locale: Locale,
  system: UnitSystem
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
  const display = displayUnit(canonicalUnit, system);
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
 *
 * In the imperial system, lengths, masses, speeds, temperatures and drink
 * volumes convert; grams, milligrams, litres of lung volume, mmHg and the
 * rest stay as US nutrition labels and clinics write them. Temperatures are
 * absolute readings here, so °F takes the +32 offset.
 */
export function displayUnit(unit: string | null, system: UnitSystem): UnitDisplay {
  if (system === 'imperial') {
    switch (unit) {
      case 'km':
        return { unit: 'mi', convert: (v) => v * MI_PER_KM };
      case 'km/hr':
        return { unit: 'mph', convert: (v) => v * MI_PER_KM };
      case 'm':
        return { unit: 'ft', convert: (v) => v * FT_PER_M };
      case 'm/s':
        return { unit: 'ft/s', convert: (v) => v * FT_PER_M };
      case 'cm':
        return { unit: 'in', convert: (v) => v * IN_PER_CM };
      case 'kg':
        return { unit: 'lb', convert: (v) => v * LB_PER_KG };
      case 'mL':
        return { unit: 'fl oz', convert: (v) => v * FLOZ_PER_ML };
      case 'degC':
        return { unit: '°F', convert: (v) => (v * 9) / 5 + 32 };
    }
  }
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

/**
 * Row labels of a week-by-column heatmap whose first row is `weekStart` (ISO
 * weekday, 1 = Monday): the narrow names of rows 1, 3 and 5, blanks between,
 * so the grid reads at a glance without crowding its edge.
 */
export function weekdayInitials(locale: Locale, weekStart: number): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'narrow', timeZone: 'UTC' });
  // 2024-01-01 was a Monday: ISO weekday d falls on 2024-01-0d.
  return Array.from({ length: 7 }, (_, i) => {
    if (i % 2 === 1 || i === 6) return '';
    const iso = ((weekStart - 1 + i) % 7) + 1;
    return fmt.format(new Date(Date.UTC(2024, 0, iso)));
  });
}
