// Presentation catalogue for metric types. Everything here is DISPLAY: the
// ingestion and read semantics of a type (kind, aggregation, regime, canonical
// unit) live in the metric_types table and are read from it, never guessed
// from an identifier. What this module answers is only: under which heading
// does a type appear, in which family colour, behind which glyph, with which
// human label, and does going DOWN read as an improvement.
//
// The taxonomy is RULE-BASED on purpose. A type promoted in the database
// tomorrow must show up in the catalogue with a sensible heading, colour and
// glyph without a line of code being written here: the ordered RULES table
// classifies by identifier shape, LABELS only improves the wording, and
// OVERRIDES exists for the handful of types a rule gets wrong. A type matching
// nothing lands in "Other", neutral, with its de-prefixed identifier as label
// — degraded, never hidden.
import type { Locale } from '@/lib/i18n';

/**
 * Colour families. Stable per measure family, one --data-* token each
 * (design system): charts and icons of a family always read in its colour.
 */
export type DataFamily =
  | 'heart'
  | 'energy'
  | 'power'
  | 'activity'
  | 'distance'
  | 'sleep'
  | 'water'
  | 'neutral';

/**
 * Headings of the catalogue screen. Coarser than the colour families: what a
 * human looks under ("where is my water intake?"), not what a chart paints.
 * Order is the display order and is deliberate: the body's own signals first,
 * the residual last.
 */
export type MetricGroup =
  | 'heart'
  | 'respiratory'
  | 'body'
  | 'activity'
  | 'mobility'
  | 'sleep'
  | 'nutrition'
  | 'audio'
  | 'other';

export const METRIC_GROUPS: readonly MetricGroup[] = [
  'heart',
  'respiratory',
  'body',
  'activity',
  'mobility',
  'sleep',
  'nutrition',
  'audio',
  'other',
];

/**
 * Which direction of change reads as an improvement. Drives the TrendChip:
 * 'lower-better' flips the quality colour (the design system's `invert`),
 * 'neutral' removes the quality channel entirely — a body temperature or a
 * blood pressure that moved is not "good news", and painting it green would
 * be an opinion. Hygie is an instrument, not a coach: `neutral` is the
 * default whenever the direction is arguable.
 */
export type MetricQuality = 'higher-better' | 'lower-better' | 'neutral';

export interface MetricDisplay {
  group: MetricGroup;
  family: DataFamily;
  icon: string;
  quality: MetricQuality;
}

interface Rule extends MetricDisplay {
  re: RegExp;
}

/**
 * Ordered classifier, first match wins. Read it top to bottom as a decision
 * list: the specific cases of a family come before its catch-all, and the
 * families whose identifiers overlap (WalkingHeartRateAverage is a heart
 * metric, not a gait metric) come before the ones they would be captured by.
 */
const RULES: readonly Rule[] = [
  // --- heart: specific cases first, the plain HeartRate catch-all last ------
  { re: /HeartRateVariability/, group: 'heart', family: 'heart', icon: 'ecg', quality: 'higher-better' },
  { re: /HeartRateRecovery/, group: 'heart', family: 'heart', icon: 'ecg_heart', quality: 'higher-better' },
  { re: /RestingHeartRate|WalkingHeartRateAverage/, group: 'heart', family: 'heart', icon: 'favorite', quality: 'lower-better' },
  { re: /(High|Low|IrregularHeartRhythm)(HeartRate)?Event/, group: 'heart', family: 'heart', icon: 'ecg_heart', quality: 'lower-better' },
  { re: /AtrialFibrillation/, group: 'heart', family: 'heart', icon: 'ecg_heart', quality: 'lower-better' },
  { re: /BloodPressure/, group: 'heart', family: 'heart', icon: 'monitor_heart', quality: 'neutral' },
  { re: /HeartRate|Cardio/, group: 'heart', family: 'heart', icon: 'favorite', quality: 'neutral' },
  { re: /VO2Max/, group: 'heart', family: 'heart', icon: 'air', quality: 'higher-better' },

  // --- respiratory ----------------------------------------------------------
  { re: /OxygenSaturation/, group: 'respiratory', family: 'water', icon: 'spo2', quality: 'higher-better' },
  { re: /RespiratoryRate|ForcedVital|PeakExpiratory/, group: 'respiratory', family: 'water', icon: 'pulmonology', quality: 'neutral' },

  // --- sleep (before the mobility and body rules: AppleSleepingWrist... ) ---
  { re: /Sleep/, group: 'sleep', family: 'sleep', icon: 'bedtime', quality: 'neutral' },

  // --- nutrition (before every Water / Energy rule: DietaryWater, kcal) -----
  { re: /DietaryWater/, group: 'nutrition', family: 'water', icon: 'water_drop', quality: 'higher-better' },
  { re: /DietaryEnergyConsumed/, group: 'nutrition', family: 'energy', icon: 'restaurant', quality: 'neutral' },
  { re: /DietaryCaffeine/, group: 'nutrition', family: 'neutral', icon: 'coffee', quality: 'neutral' },
  { re: /DietaryProtein/, group: 'nutrition', family: 'neutral', icon: 'egg', quality: 'neutral' },
  { re: /DietaryCarbohydrates|DietaryFiber|DietarySugar/, group: 'nutrition', family: 'neutral', icon: 'grain', quality: 'neutral' },
  { re: /DietaryFat|DietaryCholesterol/, group: 'nutrition', family: 'neutral', icon: 'opacity', quality: 'neutral' },
  { re: /DietaryVitamin|DietaryBiotin|DietaryFolate|DietaryNiacin|DietaryPantothenicAcid|DietaryRiboflavin|DietaryThiamin/, group: 'nutrition', family: 'neutral', icon: 'medication', quality: 'neutral' },
  { re: /AlcoholicBeverages|BloodAlcohol/, group: 'nutrition', family: 'neutral', icon: 'local_bar', quality: 'lower-better' },
  { re: /Dietary/, group: 'nutrition', family: 'neutral', icon: 'science', quality: 'neutral' },

  // --- audio ----------------------------------------------------------------
  { re: /SoundReduction/, group: 'audio', family: 'neutral', icon: 'volume_down', quality: 'higher-better' },
  { re: /Headphone/, group: 'audio', family: 'neutral', icon: 'headphones', quality: 'lower-better' },
  { re: /Audio|Sound/, group: 'audio', family: 'neutral', icon: 'volume_up', quality: 'lower-better' },

  // --- mobility (gait quality; before the activity catch-alls) --------------
  { re: /WalkingSteadiness/, group: 'mobility', family: 'activity', icon: 'accessible', quality: 'higher-better' },
  { re: /WalkingAsymmetry|DoubleSupport/, group: 'mobility', family: 'activity', icon: 'accessible', quality: 'lower-better' },
  { re: /WalkingSpeed|WalkingStepLength/, group: 'mobility', family: 'activity', icon: 'directions_walk', quality: 'higher-better' },
  { re: /Stair(Ascent|Descent)Speed/, group: 'mobility', family: 'activity', icon: 'stairs', quality: 'higher-better' },
  { re: /SixMinuteWalkTest/, group: 'mobility', family: 'activity', icon: 'directions_walk', quality: 'higher-better' },

  // --- body measurements ----------------------------------------------------
  { re: /BodyFatPercentage/, group: 'body', family: 'water', icon: 'percent', quality: 'lower-better' },
  { re: /LeanBodyMass/, group: 'body', family: 'water', icon: 'accessibility_new', quality: 'higher-better' },
  { re: /BodyMassIndex/, group: 'body', family: 'water', icon: 'monitor_weight', quality: 'lower-better' },
  { re: /BodyMass|WaistCircumference/, group: 'body', family: 'water', icon: 'monitor_weight', quality: 'lower-better' },
  { re: /Height/, group: 'body', family: 'water', icon: 'straighten', quality: 'neutral' },
  { re: /BodyTemperature|BasalBodyTemperature/, group: 'body', family: 'water', icon: 'thermostat', quality: 'neutral' },

  // --- activity -------------------------------------------------------------
  { re: /StepCount/, group: 'activity', family: 'activity', icon: 'steps', quality: 'higher-better' },
  { re: /FlightsClimbed/, group: 'activity', family: 'activity', icon: 'floor', quality: 'higher-better' },
  { re: /BasalEnergyBurned/, group: 'activity', family: 'energy', icon: 'local_fire_department', quality: 'neutral' },
  { re: /EnergyBurned/, group: 'activity', family: 'energy', icon: 'local_fire_department', quality: 'higher-better' },
  { re: /AppleExerciseTime|AppleMoveTime/, group: 'activity', family: 'activity', icon: 'exercise', quality: 'higher-better' },
  { re: /AppleStand/, group: 'activity', family: 'activity', icon: 'airline_seat_recline_normal', quality: 'higher-better' },
  { re: /EffortScore|PhysicalEffort/, group: 'activity', family: 'energy', icon: 'fitness_center', quality: 'neutral' },
  { re: /DistanceCycling|CyclingCadence|CyclingPower|CyclingSpeed|CyclingFunctionalThreshold/, group: 'activity', family: 'distance', icon: 'directions_bike', quality: 'neutral' },
  { re: /Rowing/, group: 'activity', family: 'distance', icon: 'rowing', quality: 'neutral' },
  { re: /Swimming|UnderwaterDepth|WaterTemperature/, group: 'activity', family: 'water', icon: 'pool', quality: 'neutral' },
  { re: /RunningPower/, group: 'activity', family: 'power', icon: 'bolt', quality: 'neutral' },
  { re: /Running|Nike/, group: 'activity', family: 'activity', icon: 'directions_run', quality: 'neutral' },
  { re: /Distance/, group: 'activity', family: 'activity', icon: 'directions_walk', quality: 'higher-better' },

  // --- residual -------------------------------------------------------------
  { re: /TimeInDaylight/, group: 'other', family: 'neutral', icon: 'sunny', quality: 'higher-better' },
  { re: /Mindful/, group: 'other', family: 'sleep', icon: 'self_improvement', quality: 'higher-better' },
  { re: /SexualActivity/, group: 'other', family: 'neutral', icon: 'favorite', quality: 'neutral' },
  { re: /Menstrual|Ovulation|Cervical|Contraceptive|Pregnancy|Lactation/, group: 'other', family: 'neutral', icon: 'calendar_month', quality: 'neutral' },
  { re: /Insulin|BloodGlucose/, group: 'other', family: 'neutral', icon: 'glucose', quality: 'neutral' },
];

const FALLBACK: MetricDisplay = {
  group: 'other',
  family: 'neutral',
  icon: 'query_stats',
  quality: 'neutral',
};

/**
 * Types the rules classify wrongly, or where the measured reality of this
 * export argues differently. Kept tiny on purpose: an entry here is a rule
 * that did not generalise, and the rule is the thing to fix first.
 */
const OVERRIDES: Readonly<Record<string, Partial<MetricDisplay>>> = {
  // Cadence and stride are running dynamics, but their colour follows the
  // sport they were measured in, not the "activity" green of step counting.
  HKQuantityTypeIdentifierRunningStrideLength: { icon: 'steps' },
  HKQuantityTypeIdentifierRunningGroundContactTime: { icon: 'timer', quality: 'lower-better' },
  HKQuantityTypeIdentifierRunningVerticalOscillation: { icon: 'height', quality: 'lower-better' },
  HKQuantityTypeIdentifierRunningSpeed: { icon: 'speed' },
  // Sleep-borne signals: the Sleep rule catches them, but they read as body
  // and respiratory measures, which is where a human looks for them.
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: { icon: 'thermostat' },
  HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances: {
    icon: 'pulmonology',
    quality: 'lower-better',
  },
  // A goal is a setting, not a measure: no quality direction whatsoever.
  HKDataTypeSleepDurationGoal: { icon: 'flag', quality: 'neutral' },
  // Caught by the Running rule (it is one identifier for both), but it is the
  // ground a day covered on foot, and it reads as walking.
  HKQuantityTypeIdentifierDistanceWalkingRunning: {
    icon: 'directions_walk',
    quality: 'higher-better',
  },
  // The records count BOTH stood and idle hours (metric_category_values), so
  // "more of them" is not an improvement, it is a longer day of wear.
  HKCategoryTypeIdentifierAppleStandHour: { quality: 'neutral' },
};

/**
 * Human labels, `[en, fr]`. Presentation only: a type absent from this table
 * still appears everywhere, labelled by its de-prefixed identifier. Adding a
 * pair here improves the wording, it never gates visibility.
 */
const LABELS: Readonly<Record<string, readonly [string, string]>> = {
  // heart
  HKQuantityTypeIdentifierHeartRate: ['Heart rate', 'Fréquence cardiaque'],
  HKQuantityTypeIdentifierRestingHeartRate: ['Resting heart rate', 'FC de repos'],
  HKQuantityTypeIdentifierWalkingHeartRateAverage: ['Walking heart rate', 'FC de marche'],
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: ['HRV (SDNN)', 'VFC (SDNN)'],
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: ['1 min HR recovery', 'Récupération FC à 1 min'],
  HKQuantityTypeIdentifierAtrialFibrillationBurden: ['Atrial fibrillation burden', 'Charge de fibrillation atriale'],
  HKQuantityTypeIdentifierBloodPressureSystolic: ['Systolic pressure', 'Tension systolique'],
  HKQuantityTypeIdentifierBloodPressureDiastolic: ['Diastolic pressure', 'Tension diastolique'],
  HKQuantityTypeIdentifierVO2Max: ['VO₂ max', 'VO₂ max'],
  HKCategoryTypeIdentifierHighHeartRateEvent: ['High heart rate events', 'Alertes FC haute'],
  HKCategoryTypeIdentifierLowHeartRateEvent: ['Low heart rate events', 'Alertes FC basse'],
  HKCategoryTypeIdentifierIrregularHeartRhythmEvent: ['Irregular rhythm events', 'Alertes de rythme irrégulier'],

  // respiratory
  HKQuantityTypeIdentifierRespiratoryRate: ['Respiratory rate', 'Fréquence respiratoire'],
  HKQuantityTypeIdentifierOxygenSaturation: ['Blood oxygen', 'SpO₂'],

  // body
  HKQuantityTypeIdentifierBodyMass: ['Weight', 'Poids'],
  HKQuantityTypeIdentifierBodyMassIndex: ['Body mass index', 'Indice de masse corporelle'],
  HKQuantityTypeIdentifierBodyFatPercentage: ['Body fat', 'Masse grasse'],
  HKQuantityTypeIdentifierLeanBodyMass: ['Lean body mass', 'Masse maigre'],
  HKQuantityTypeIdentifierHeight: ['Height', 'Taille'],
  HKQuantityTypeIdentifierBodyTemperature: ['Body temperature', 'Température corporelle'],

  // activity
  HKQuantityTypeIdentifierStepCount: ['Steps', 'Pas'],
  HKQuantityTypeIdentifierDistanceWalkingRunning: ['Walking + running distance', 'Distance marche et course'],
  HKQuantityTypeIdentifierDistanceCycling: ['Cycling distance', 'Distance vélo'],
  HKQuantityTypeIdentifierDistanceRowing: ['Rowing distance', 'Distance rameur'],
  HKQuantityTypeIdentifierFlightsClimbed: ['Flights climbed', 'Étages gravis'],
  HKQuantityTypeIdentifierActiveEnergyBurned: ['Active energy', 'Énergie active'],
  HKQuantityTypeIdentifierBasalEnergyBurned: ['Basal energy', 'Énergie de repos'],
  HKQuantityTypeIdentifierAppleExerciseTime: ['Exercise time', 'Temps d’exercice'],
  HKQuantityTypeIdentifierAppleStandTime: ['Stand time', 'Temps debout'],
  HKCategoryTypeIdentifierAppleStandHour: ['Stand hours', 'Heures debout'],
  HKQuantityTypeIdentifierPhysicalEffort: ['Physical effort', 'Effort physique'],
  HKQuantityTypeIdentifierWorkoutEffortScore: ['Workout effort score', 'Score d’effort de séance'],
  HKQuantityTypeIdentifierEstimatedWorkoutEffortScore: ['Estimated effort score', 'Score d’effort estimé'],
  HKQuantityTypeIdentifierRunningPower: ['Running power', 'Puissance de course'],
  HKQuantityTypeIdentifierRunningSpeed: ['Running speed', 'Vitesse de course'],
  HKQuantityTypeIdentifierRunningStrideLength: ['Stride length', 'Longueur de foulée'],
  HKQuantityTypeIdentifierRunningGroundContactTime: ['Ground contact time', 'Temps de contact au sol'],
  HKQuantityTypeIdentifierRunningVerticalOscillation: ['Vertical oscillation', 'Oscillation verticale'],
  HKQuantityTypeIdentifierCyclingCadence: ['Cycling cadence', 'Cadence vélo'],
  HKQuantityTypeIdentifierRowingSpeed: ['Rowing speed', 'Vitesse rameur'],
  HKQuantityTypeIdentifierUnderwaterDepth: ['Underwater depth', 'Profondeur sous l’eau'],
  HKQuantityTypeIdentifierWaterTemperature: ['Water temperature', 'Température de l’eau'],

  // mobility
  HKQuantityTypeIdentifierWalkingSpeed: ['Walking speed', 'Vitesse de marche'],
  HKQuantityTypeIdentifierWalkingStepLength: ['Step length', 'Longueur de pas'],
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: ['Walking asymmetry', 'Asymétrie de marche'],
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: ['Double support time', 'Temps de double appui'],
  HKQuantityTypeIdentifierAppleWalkingSteadiness: ['Walking steadiness', 'Stabilité de la marche'],
  HKQuantityTypeIdentifierStairAscentSpeed: ['Stair ascent speed', 'Vitesse en montée d’escalier'],
  HKQuantityTypeIdentifierStairDescentSpeed: ['Stair descent speed', 'Vitesse en descente d’escalier'],
  HKQuantityTypeIdentifierSixMinuteWalkTestDistance: ['6-minute walk distance', 'Distance au test de 6 minutes'],

  // sleep
  HKCategoryTypeIdentifierSleepAnalysis: ['Sleep segments', 'Segments de sommeil'],
  HKDataTypeSleepDurationGoal: ['Sleep goal', 'Objectif de sommeil'],
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: ['Wrist temperature', 'Température du poignet'],
  HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances: [
    'Breathing disturbances',
    'Perturbations respiratoires',
  ],

  // nutrition and hydration
  HKQuantityTypeIdentifierDietaryWater: ['Water intake', 'Eau bue'],
  HKQuantityTypeIdentifierDietaryEnergyConsumed: ['Energy consumed', 'Énergie consommée'],
  HKQuantityTypeIdentifierDietaryProtein: ['Protein', 'Protéines'],
  HKQuantityTypeIdentifierDietaryCarbohydrates: ['Carbohydrates', 'Glucides'],
  HKQuantityTypeIdentifierDietarySugar: ['Sugar', 'Sucres'],
  HKQuantityTypeIdentifierDietaryFiber: ['Fibre', 'Fibres'],
  HKQuantityTypeIdentifierDietaryFatTotal: ['Total fat', 'Lipides totaux'],
  HKQuantityTypeIdentifierDietaryFatSaturated: ['Saturated fat', 'Acides gras saturés'],
  HKQuantityTypeIdentifierDietaryFatMonounsaturated: ['Monounsaturated fat', 'Acides gras mono-insaturés'],
  HKQuantityTypeIdentifierDietaryFatPolyunsaturated: ['Polyunsaturated fat', 'Acides gras poly-insaturés'],
  HKQuantityTypeIdentifierDietaryCholesterol: ['Cholesterol', 'Cholestérol'],
  HKQuantityTypeIdentifierDietarySodium: ['Sodium', 'Sodium'],
  HKQuantityTypeIdentifierDietaryPotassium: ['Potassium', 'Potassium'],
  HKQuantityTypeIdentifierDietaryCalcium: ['Calcium', 'Calcium'],
  HKQuantityTypeIdentifierDietaryIron: ['Iron', 'Fer'],
  HKQuantityTypeIdentifierDietaryMagnesium: ['Magnesium', 'Magnésium'],
  HKQuantityTypeIdentifierDietaryPhosphorus: ['Phosphorus', 'Phosphore'],
  HKQuantityTypeIdentifierDietaryZinc: ['Zinc', 'Zinc'],
  HKQuantityTypeIdentifierDietaryCopper: ['Copper', 'Cuivre'],
  HKQuantityTypeIdentifierDietaryManganese: ['Manganese', 'Manganèse'],
  HKQuantityTypeIdentifierDietarySelenium: ['Selenium', 'Sélénium'],
  HKQuantityTypeIdentifierDietaryIodine: ['Iodine', 'Iode'],
  HKQuantityTypeIdentifierDietaryVitaminA: ['Vitamin A', 'Vitamine A'],
  HKQuantityTypeIdentifierDietaryVitaminC: ['Vitamin C', 'Vitamine C'],
  HKQuantityTypeIdentifierDietaryVitaminD: ['Vitamin D', 'Vitamine D'],
  HKQuantityTypeIdentifierDietaryVitaminE: ['Vitamin E', 'Vitamine E'],
  HKQuantityTypeIdentifierDietaryVitaminK: ['Vitamin K', 'Vitamine K'],
  HKQuantityTypeIdentifierDietaryVitaminB6: ['Vitamin B6', 'Vitamine B6'],
  HKQuantityTypeIdentifierDietaryVitaminB12: ['Vitamin B12', 'Vitamine B12'],
  HKQuantityTypeIdentifierDietaryThiamin: ['Thiamin (B1)', 'Thiamine (B1)'],
  HKQuantityTypeIdentifierDietaryRiboflavin: ['Riboflavin (B2)', 'Riboflavine (B2)'],
  HKQuantityTypeIdentifierDietaryNiacin: ['Niacin (B3)', 'Niacine (B3)'],
  HKQuantityTypeIdentifierDietaryPantothenicAcid: ['Pantothenic acid (B5)', 'Acide pantothénique (B5)'],
  HKQuantityTypeIdentifierDietaryBiotin: ['Biotin (B8)', 'Biotine (B8)'],
  HKQuantityTypeIdentifierDietaryFolate: ['Folate (B9)', 'Folates (B9)'],
  HKQuantityTypeIdentifierNumberOfAlcoholicBeverages: ['Alcoholic drinks', 'Boissons alcoolisées'],

  // audio
  HKQuantityTypeIdentifierEnvironmentalAudioExposure: ['Environmental sound', 'Bruit ambiant'],
  HKQuantityTypeIdentifierHeadphoneAudioExposure: ['Headphone audio', 'Audio au casque'],
  HKQuantityTypeIdentifierEnvironmentalSoundReduction: ['Sound reduction', 'Réduction du bruit'],
  HKCategoryTypeIdentifierAudioExposureEvent: ['Loud environment alerts', 'Alertes de bruit ambiant'],
  HKCategoryTypeIdentifierHeadphoneAudioExposureEvent: ['Headphone level alerts', 'Alertes de niveau au casque'],

  // other
  HKQuantityTypeIdentifierTimeInDaylight: ['Time in daylight', 'Temps à la lumière du jour'],
  HKCategoryTypeIdentifierMindfulSession: ['Mindful sessions', 'Séances de pleine conscience'],
  HKCategoryTypeIdentifierSexualActivity: ['Sexual activity', 'Activité sexuelle'],
};

const displayCache = new Map<string, MetricDisplay>();

/** Rule match, then override. Memoized: called once per row of the catalogue. */
export function metricDisplay(hkIdentifier: string): MetricDisplay {
  const hit = displayCache.get(hkIdentifier);
  if (hit) return hit;
  const rule = RULES.find((r) => r.re.test(hkIdentifier));
  const base: MetricDisplay = rule
    ? { group: rule.group, family: rule.family, icon: rule.icon, quality: rule.quality }
    : FALLBACK;
  const display = { ...base, ...OVERRIDES[hkIdentifier] };
  displayCache.set(hkIdentifier, display);
  return display;
}

export function dataColor(family: DataFamily): string {
  return `var(--data-${family})`;
}

/** Falls back to a de-prefixed HK identifier so unknown types stay readable. */
export function metricLabel(hkIdentifier: string, locale: Locale): string {
  const pair = LABELS[hkIdentifier];
  if (pair) return locale === 'fr' ? pair[1] : pair[0];
  return humanizeIdentifier(hkIdentifier);
}

/** `HKQuantityTypeIdentifierBodyMass` -> `Body mass`. Last-resort labelling. */
function humanizeIdentifier(hkIdentifier: string): string {
  const bare = metricSlug(hkIdentifier);
  const spaced = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\bHK\b/, '');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function metricFamily(hkIdentifier: string): DataFamily {
  return metricDisplay(hkIdentifier).family;
}

export function metricGroup(hkIdentifier: string): MetricGroup {
  return metricDisplay(hkIdentifier).group;
}

export function metricIcon(hkIdentifier: string): string {
  return metricDisplay(hkIdentifier).icon;
}

export function metricQuality(hkIdentifier: string): MetricQuality {
  return metricDisplay(hkIdentifier).quality;
}

// --- URL identity ------------------------------------------------------------

const PREFIX_RE = /^HK(Quantity|Category)TypeIdentifier/;

/**
 * URL segment for a type: the identifier without its HealthKit prefix
 * (`DietaryWater`), which keeps `/metrics/...` readable. Identifiers carrying
 * another prefix (`HKDataTypeSleepDurationGoal`) are used as-is: the slug is
 * only ever a shortening, never a rename.
 */
export function metricSlug(hkIdentifier: string): string {
  return hkIdentifier.replace(PREFIX_RE, '');
}

/**
 * Reverse of metricSlug, resolved against the identifiers that actually exist
 * in the taxonomy — never by rebuilding a prefix blindly. A full identifier is
 * accepted too, so an old link keeps working. Case-insensitive: a slug typed
 * by hand should not 404 over one capital.
 */
export function metricFromSlug(slug: string, known: Iterable<string>): string | null {
  const wanted = decodeURIComponent(slug).toLowerCase();
  let caseInsensitive: string | null = null;
  for (const hk of known) {
    if (hk === slug || metricSlug(hk) === slug) return hk;
    if (caseInsensitive === null && (hk.toLowerCase() === wanted || metricSlug(hk).toLowerCase() === wanted)) {
      caseInsensitive = hk;
    }
  }
  return caseInsensitive;
}

/** Canonical detail-screen path for a type. */
export function metricHref(hkIdentifier: string, search?: string): string {
  const base = `/metrics/${encodeURIComponent(metricSlug(hkIdentifier))}`;
  return search ? `${base}?${search}` : base;
}
