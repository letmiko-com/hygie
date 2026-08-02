// Types of the Health Auto Export (HAE) JSON payload, format v2.
// Derived from real captured payloads (2026-08) and docs/hae-mapping.md.
// HAE serializes numbers as plain JSON numbers and dates as
// "YYYY-MM-DD HH:MM:SS ±HHMM" (local time with explicit offset).

/** A quantity with its unit, e.g. { qty: 2.01, units: "km" }. */
export interface HaeQuantity {
  qty: number;
  units: string;
}

/** Common shape of one simple metric data point. */
export interface HaeQtyPoint {
  date: string;
  qty: number;
  source?: string;
}

/** heart_rate points carry Min/Avg/Max instead of qty (raw samples keep Min==Avg==Max). */
export interface HaeHeartRatePoint {
  date: string;
  Min: number;
  Avg: number;
  Max: number;
  source?: string;
}

/** blood_pressure arrives fused: one point = systolic + diastolic. */
export interface HaeBloodPressurePoint {
  date: string;
  systolic: number;
  diastolic: number;
  source?: string;
}

/** sleep_analysis is a daily summary, durations in the metric's units (observed: hr). */
export interface HaeSleepAnalysisPoint {
  date: string;
  source?: string;
  asleep: number;
  core: number;
  deep: number;
  rem: number;
  awake: number;
  inBed: number;
  totalSleep?: number;
  sleepStart?: string;
  sleepEnd?: string;
  inBedStart?: string;
  inBedEnd?: string;
}

/** sexual_activity is pivoted into three columns. Sensitive: opt-in per subject. */
export interface HaeSexualActivityPoint {
  date: string;
  source?: string;
  'Protection Used': number;
  'Protection Not Used': number;
  Unspecified: number;
}

export type HaeMetricPoint =
  | HaeQtyPoint
  | HaeHeartRatePoint
  | HaeBloodPressurePoint
  | HaeSleepAnalysisPoint
  | HaeSexualActivityPoint;

export interface HaeMetric {
  name: string;
  units: string;
  data: HaeMetricPoint[];
}

/** One point of a per-minute workout series (activeEnergy, stepCount, ...). */
export interface HaeWorkoutSeriesPoint {
  date: string;
  qty: number;
  units: string;
  source?: string;
}

/** One point of the 1 Hz post-workout recovery heart rate series (IGNORED by design). */
export interface HaeWorkoutHeartRatePoint {
  date: string;
  Min: number;
  Avg: number;
  Max: number;
  units: string;
  source?: string;
}

/** One inline GPS route point. */
export interface HaeRoutePoint {
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  course?: number;
  courseAccuracy?: number;
  horizontalAccuracy?: number;
  verticalAccuracy?: number;
}

export interface HaeWorkout {
  /** HAE-side UUID, absent from the XML export: goes to workout_external_ids. */
  id: string;
  /** Display name ("Outdoor Run"), mapped to HKWorkoutActivityType*. */
  name: string;
  start: string;
  end: string;
  /** Seconds. */
  duration: number;
  isIndoor?: boolean;
  location?: string;
  distance?: HaeQuantity;
  activeEnergyBurned?: HaeQuantity;
  totalEnergy?: HaeQuantity;
  elevationUp?: HaeQuantity;
  flightsClimbed?: HaeQuantity;
  stepCadence?: HaeQuantity;
  speed?: HaeQuantity;
  avgSpeed?: HaeQuantity;
  maxSpeed?: HaeQuantity;
  intensity?: HaeQuantity;
  temperature?: HaeQuantity;
  humidity?: HaeQuantity;
  /** Recovery values (2 min post-workout): NEVER ingested as workout heart rate. */
  avgHeartRate?: HaeQuantity;
  /** Recovery values (2 min post-workout): NEVER ingested as workout heart rate. */
  maxHeartRate?: HaeQuantity;
  /** Recovery summary: NEVER ingested. */
  heartRate?: { min: HaeQuantity; max: HaeQuantity; avg: HaeQuantity };
  /** Post-workout recovery series at 1 Hz: NEVER ingested. */
  heartRateData?: HaeWorkoutHeartRatePoint[];
  activeEnergy?: HaeWorkoutSeriesPoint[];
  basalEnergy?: HaeWorkoutSeriesPoint[];
  stepCount?: HaeWorkoutSeriesPoint[];
  walkingAndRunningDistance?: HaeWorkoutSeriesPoint[];
  route?: HaeRoutePoint[];
  metadata?: Record<string, unknown>;
}

export interface HaePayload {
  data: {
    metrics?: HaeMetric[];
    workouts?: HaeWorkout[];
  };
}

/** Runtime shape check for the top level (validation step; never trusts casts). */
export function isHaePayload(value: unknown): value is HaePayload {
  if (typeof value !== 'object' || value === null) return false;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return false;
  const { metrics, workouts } = data as { metrics?: unknown; workouts?: unknown };
  if (metrics !== undefined && !Array.isArray(metrics)) return false;
  if (workouts !== undefined && !Array.isArray(workouts)) return false;
  return metrics !== undefined || workouts !== undefined;
}
