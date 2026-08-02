// Display catalogue for metric types: family color (the --data-* token
// families are stable per measure family, per the design system), icon and
// bilingual label. Purely presentational: ingestion semantics live in the
// metric_types table. Types absent from this catalogue fall back to a
// neutral rendering of their HK identifier.
import type { Locale } from '@/lib/i18n';

export type DataFamily =
  | 'heart'
  | 'energy'
  | 'power'
  | 'activity'
  | 'distance'
  | 'sleep'
  | 'water'
  | 'neutral';

export interface MetricDisplay {
  family: DataFamily;
  icon: string;
  label: Record<Locale, string>;
}

export const METRIC_DISPLAY: Record<string, MetricDisplay> = {
  HKQuantityTypeIdentifierHeartRate: {
    family: 'heart',
    icon: 'favorite',
    label: { en: 'Heart rate', fr: 'Fréquence cardiaque' },
  },
  HKQuantityTypeIdentifierRestingHeartRate: {
    family: 'heart',
    icon: 'favorite',
    label: { en: 'Resting heart rate', fr: 'FC repos' },
  },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: {
    family: 'heart',
    icon: 'favorite',
    label: { en: 'Walking heart rate', fr: 'FC de marche' },
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    family: 'heart',
    icon: 'ecg',
    label: { en: 'HRV', fr: 'VFC' },
  },
  HKQuantityTypeIdentifierActiveEnergyBurned: {
    family: 'energy',
    icon: 'local_fire_department',
    label: { en: 'Active energy', fr: 'Énergie active' },
  },
  HKQuantityTypeIdentifierBasalEnergyBurned: {
    family: 'energy',
    icon: 'local_fire_department',
    label: { en: 'Basal energy', fr: 'Énergie basale' },
  },
  HKQuantityTypeIdentifierStepCount: {
    family: 'activity',
    icon: 'steps',
    label: { en: 'Steps', fr: 'Pas' },
  },
  HKQuantityTypeIdentifierDistanceWalkingRunning: {
    family: 'activity',
    icon: 'directions_walk',
    label: { en: 'Walking + running distance', fr: 'Distance marche/course' },
  },
  HKQuantityTypeIdentifierDistanceCycling: {
    family: 'distance',
    icon: 'directions_bike',
    label: { en: 'Cycling distance', fr: 'Distance vélo' },
  },
  HKQuantityTypeIdentifierFlightsClimbed: {
    family: 'activity',
    icon: 'floor',
    label: { en: 'Flights climbed', fr: 'Étages gravis' },
  },
  HKQuantityTypeIdentifierAppleExerciseTime: {
    family: 'activity',
    icon: 'exercise',
    label: { en: 'Exercise time', fr: 'Temps d’exercice' },
  },
  HKQuantityTypeIdentifierAppleStandTime: {
    family: 'activity',
    icon: 'airline_seat_recline_normal',
    label: { en: 'Stand time', fr: 'Temps debout' },
  },
  HKCategoryTypeIdentifierSleepAnalysis: {
    family: 'sleep',
    icon: 'bedtime',
    label: { en: 'Sleep segments', fr: 'Segments de sommeil' },
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    family: 'water',
    icon: 'pulmonology',
    label: { en: 'Respiratory rate', fr: 'Fréquence respiratoire' },
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    family: 'water',
    icon: 'spo2',
    label: { en: 'Blood oxygen', fr: 'SpO₂' },
  },
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: {
    family: 'sleep',
    icon: 'thermostat',
    label: { en: 'Wrist temperature', fr: 'Température de poignet' },
  },
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: {
    family: 'neutral',
    icon: 'volume_up',
    label: { en: 'Environmental sound', fr: 'Bruit ambiant' },
  },
  HKQuantityTypeIdentifierHeadphoneAudioExposure: {
    family: 'neutral',
    icon: 'headphones',
    label: { en: 'Headphone audio', fr: 'Audio au casque' },
  },
  HKQuantityTypeIdentifierWalkingSpeed: {
    family: 'activity',
    icon: 'speed',
    label: { en: 'Walking speed', fr: 'Vitesse de marche' },
  },
  HKQuantityTypeIdentifierPhysicalEffort: {
    family: 'energy',
    icon: 'readiness_score',
    label: { en: 'Physical effort', fr: 'Effort physique' },
  },
};

export function dataColor(family: DataFamily): string {
  return `var(--data-${family})`;
}

/** Falls back to a de-prefixed HK identifier so unknown types stay readable. */
export function metricLabel(hkIdentifier: string, locale: Locale): string {
  const display = METRIC_DISPLAY[hkIdentifier];
  if (display) return display.label[locale];
  return hkIdentifier.replace(/^HK(Quantity|Category)TypeIdentifier/, '');
}

export function metricFamily(hkIdentifier: string): DataFamily {
  return METRIC_DISPLAY[hkIdentifier]?.family ?? 'neutral';
}
