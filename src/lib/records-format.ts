// How a sport record reads: its value in the unit its kind is measured in,
// and its label, whose distance threshold follows the account's unit system.
// Shared by the records screen and the activity timeline, so the two never
// write the same record two ways. The thresholds live here because the
// label prints them and the record query applies them.
import {
  fmtDistance,
  fmtDuration,
  fmtElevation,
  fmtPace,
  fmtSpeed,
  type UnitSystem,
} from '@/lib/format';
import type { Locale, Messages } from '@/lib/i18n';

/** Minimum distance for average pace/speed records, per sport family. */
export const MIN_PACE_DISTANCE_M = 5000;
export const MIN_SPEED_DISTANCE_M = 20000;

/**
 * A record value in canonical units (meters, seconds, sec/km, km/h or meters
 * of climb depending on kind), written for the account's unit system.
 */
export function fmtRecordValue(kind: string, value: number, locale: Locale, units: UnitSystem): string {
  switch (kind) {
    case 'longest_distance':
      return fmtDistance(value, locale, units);
    case 'longest_duration':
      return fmtDuration(value);
    case 'best_pace':
      return fmtPace(value, units);
    case 'best_speed':
      return fmtSpeed(value, locale, units);
    case 'biggest_climb':
      return fmtElevation(value, locale, units);
    default:
      return String(value);
  }
}

/** The record's label, with its distance threshold in the account's unit. */
export function recordKindLabel(kind: string, m: Messages, locale: Locale, units: UnitSystem): string {
  const label = m.records.kinds[kind] ?? kind;
  const threshold =
    kind === 'best_pace' ? MIN_PACE_DISTANCE_M : kind === 'best_speed' ? MIN_SPEED_DISTANCE_M : null;
  if (threshold === null) return label;
  // 5 km reads "5 km", or "3,1 mi": whole kilometres, one decimal of a mile.
  return label.replace('{d}', fmtDistance(threshold, locale, units, units === 'imperial' ? 1 : 0));
}
