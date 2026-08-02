// Display catalogue for HKWorkoutActivityType*: icon, color family and
// bilingual label. Covers every activity type present in the real export;
// unknown types fall back to a readable de-prefixed identifier.
import type { Locale } from '@/lib/i18n';
import { dataColor, type DataFamily } from '@/lib/metrics';

export interface SportDisplay {
  icon: string;
  family: DataFamily;
  label: Record<Locale, string>;
}

const SPORTS: Record<string, SportDisplay> = {
  HKWorkoutActivityTypeRunning: {
    icon: 'directions_run',
    family: 'activity',
    label: { en: 'Running', fr: 'Course à pied' },
  },
  HKWorkoutActivityTypeCycling: {
    icon: 'directions_bike',
    family: 'distance',
    label: { en: 'Cycling', fr: 'Vélo' },
  },
  HKWorkoutActivityTypeTraditionalStrengthTraining: {
    icon: 'fitness_center',
    family: 'power',
    label: { en: 'Strength training', fr: 'Musculation' },
  },
  HKWorkoutActivityTypeRowing: {
    icon: 'rowing',
    family: 'water',
    label: { en: 'Rowing', fr: 'Rameur' },
  },
  HKWorkoutActivityTypeMindAndBody: {
    icon: 'self_improvement',
    family: 'sleep',
    label: { en: 'Mind and body', fr: 'Corps et esprit' },
  },
  HKWorkoutActivityTypeYoga: {
    icon: 'self_improvement',
    family: 'sleep',
    label: { en: 'Yoga', fr: 'Yoga' },
  },
  HKWorkoutActivityTypeWalking: {
    icon: 'hiking',
    family: 'neutral',
    label: { en: 'Walking', fr: 'Marche' },
  },
  HKWorkoutActivityTypeHiking: {
    icon: 'hiking',
    family: 'activity',
    label: { en: 'Hiking', fr: 'Randonnée' },
  },
  HKWorkoutActivityTypeCrossTraining: {
    icon: 'exercise',
    family: 'heart',
    label: { en: 'Cross-training', fr: 'Cross-training' },
  },
  HKWorkoutActivityTypeHighIntensityIntervalTraining: {
    icon: 'timer',
    family: 'heart',
    label: { en: 'HIIT', fr: 'HIIT' },
  },
  HKWorkoutActivityTypeTennis: {
    icon: 'sports_tennis',
    family: 'energy',
    label: { en: 'Tennis', fr: 'Tennis' },
  },
  HKWorkoutActivityTypeBadminton: {
    icon: 'sports_tennis',
    family: 'energy',
    label: { en: 'Badminton', fr: 'Badminton' },
  },
  HKWorkoutActivityTypeSoccer: {
    icon: 'sports_soccer',
    family: 'activity',
    label: { en: 'Soccer', fr: 'Football' },
  },
  HKWorkoutActivityTypeSwimming: {
    icon: 'pool',
    family: 'water',
    label: { en: 'Swimming', fr: 'Natation' },
  },
  HKWorkoutActivityTypeMixedCardio: {
    icon: 'monitor_heart',
    family: 'heart',
    label: { en: 'Mixed cardio', fr: 'Cardio mixte' },
  },
  HKWorkoutActivityTypeDownhillSkiing: {
    icon: 'downhill_skiing',
    family: 'distance',
    label: { en: 'Downhill skiing', fr: 'Ski alpin' },
  },
  HKWorkoutActivityTypeCardioDance: {
    icon: 'music_note',
    family: 'energy',
    label: { en: 'Cardio dance', fr: 'Danse cardio' },
  },
  HKWorkoutActivityTypePaddleSports: {
    icon: 'kayaking',
    family: 'water',
    label: { en: 'Paddle sports', fr: 'Pagaie' },
  },
  HKWorkoutActivityTypeStairClimbing: {
    icon: 'floor',
    family: 'activity',
    label: { en: 'Stair climbing', fr: 'Montée d’escaliers' },
  },
  HKWorkoutActivityTypeElliptical: {
    icon: 'exercise',
    family: 'activity',
    label: { en: 'Elliptical', fr: 'Elliptique' },
  },
  HKWorkoutActivityTypeCooldown: {
    icon: 'airwave',
    family: 'sleep',
    label: { en: 'Cooldown', fr: 'Retour au calme' },
  },
  HKWorkoutActivityTypeCoreTraining: {
    icon: 'fitness_center',
    family: 'power',
    label: { en: 'Core training', fr: 'Gainage' },
  },
  HKWorkoutActivityTypeOther: {
    icon: 'exercise',
    family: 'neutral',
    label: { en: 'Other', fr: 'Autre' },
  },
};

const FALLBACK: SportDisplay = {
  icon: 'exercise',
  family: 'neutral',
  label: { en: 'Workout', fr: 'Séance' },
};

export function sportDisplay(activityType: string): SportDisplay {
  return SPORTS[activityType] ?? FALLBACK;
}

export function sportLabel(activityType: string, locale: Locale): string {
  const known = SPORTS[activityType];
  if (known) return known.label[locale];
  return activityType.replace(/^HKWorkoutActivityType/, '');
}

export function sportColor(activityType: string): string {
  return dataColor(sportDisplay(activityType).family);
}
