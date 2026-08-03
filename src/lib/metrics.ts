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
  HKQuantityTypeIdentifierCyclingCadence: {
    family: 'distance',
    icon: 'directions_bike',
    label: { en: 'Cycling cadence', fr: 'Cadence vélo' },
  },
  HKQuantityTypeIdentifierRunningPower: {
    family: 'power',
    icon: 'bolt',
    label: { en: 'Running power', fr: 'Puissance de course' },
  },
  HKQuantityTypeIdentifierRunningSpeed: {
    family: 'activity',
    icon: 'speed',
    label: { en: 'Running speed', fr: 'Vitesse de course' },
  },
  HKQuantityTypeIdentifierRunningStrideLength: {
    family: 'activity',
    icon: 'steps',
    label: { en: 'Stride length', fr: 'Longueur de foulée' },
  },
  HKQuantityTypeIdentifierRunningGroundContactTime: {
    family: 'activity',
    icon: 'timer',
    label: { en: 'Ground contact time', fr: 'Temps de contact au sol' },
  },
  HKQuantityTypeIdentifierRunningVerticalOscillation: {
    family: 'activity',
    icon: 'height',
    label: { en: 'Vertical oscillation', fr: 'Oscillation verticale' },
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
  // Every remaining type carrying data in the real export: the explorer
  // offers the whole taxonomy, and an offer must be readable.
  HKQuantityTypeIdentifierWalkingStepLength: {
    family: 'activity',
    icon: 'steps',
    label: { en: 'Walking step length', fr: 'Longueur de pas' },
  },
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: {
    family: 'activity',
    icon: 'steps',
    label: { en: 'Double support time', fr: 'Temps de double appui' },
  },
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: {
    family: 'activity',
    icon: 'steps',
    label: { en: 'Walking asymmetry', fr: 'Asymétrie de marche' },
  },
  HKQuantityTypeIdentifierStairAscentSpeed: {
    family: 'activity',
    icon: 'floor',
    label: { en: 'Stair ascent speed', fr: 'Vitesse en montée d’escalier' },
  },
  HKQuantityTypeIdentifierStairDescentSpeed: {
    family: 'activity',
    icon: 'floor',
    label: { en: 'Stair descent speed', fr: 'Vitesse en descente d’escalier' },
  },
  HKQuantityTypeIdentifierDietaryWater: {
    family: 'water',
    icon: 'water_drop',
    label: { en: 'Water intake', fr: 'Eau bue' },
  },
  HKQuantityTypeIdentifierTimeInDaylight: {
    family: 'neutral',
    icon: 'sunny',
    label: { en: 'Time in daylight', fr: 'Temps à la lumière du jour' },
  },
  HKQuantityTypeIdentifierBodyTemperature: {
    family: 'water',
    icon: 'thermostat',
    label: { en: 'Body temperature', fr: 'Température corporelle' },
  },
  HKQuantityTypeIdentifierBloodPressureSystolic: {
    family: 'heart',
    icon: 'monitor_heart',
    label: { en: 'Systolic pressure', fr: 'Tension systolique' },
  },
  HKQuantityTypeIdentifierBloodPressureDiastolic: {
    family: 'heart',
    icon: 'monitor_heart',
    label: { en: 'Diastolic pressure', fr: 'Tension diastolique' },
  },
  HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances: {
    family: 'sleep',
    icon: 'pulmonology',
    label: { en: 'Breathing disturbances', fr: 'Perturbations respiratoires' },
  },
  HKQuantityTypeIdentifierNumberOfAlcoholicBeverages: {
    family: 'neutral',
    icon: 'local_bar',
    label: { en: 'Alcoholic drinks', fr: 'Boissons alcoolisées' },
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
