// Simple records (MVP): honest facts computed from whole workouts only.
// Longest distance, longest duration, best average pace/speed over a
// minimum distance, biggest climb. No derived race times (a "best 10K"
// inside a longer session would need the fine-grained distance series,
// which only HAE workouts carry): a record here is always one real session.
// 962 workouts fit in memory; one light query, reductions in JS.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';

export interface WorkoutLite {
  id: string;
  activityType: string;
  startTs: Date;
  durationS: number;
  distanceM: number | null;
  energyKj: number | null;
  elevationUpM: number | null;
}

export async function allWorkoutsLite(ctx: SubjectContext): Promise<WorkoutLite[]> {
  interface Row {
    id: string;
    activity_type: string;
    start_ts: Date;
    duration_s: number;
    distance_m: number | null;
    energy_kj: number | null;
    elevation_up_m: number | null;
  }
  const { rows } = await getDb().query<Row>(
    `select id, activity_type, start_ts, duration_s, distance_m, energy_kj, elevation_up_m
     from workouts where subject_id = $1
     order by start_ts`,
    [ctx.subjectId]
  );
  return rows.map((r) => ({
    id: r.id,
    activityType: r.activity_type,
    startTs: r.start_ts,
    durationS: r.duration_s,
    distanceM: r.distance_m,
    energyKj: r.energy_kj,
    elevationUpM: r.elevation_up_m,
  }));
}

export type RecordKind =
  | 'longest_distance'
  | 'longest_duration'
  | 'best_pace'
  | 'best_speed'
  | 'biggest_climb';

export interface SportRecord {
  kind: RecordKind;
  activityType: string;
  /** The session that holds the record. */
  workoutId: string;
  date: Date;
  /** Canonical value: meters, seconds, sec/km, km/h or meters depending on kind. */
  value: number;
  /** Best value per calendar year (subject-local years approximated by UTC year of start). */
  progression: Array<{ year: number; value: number | null }>;
  /** Best of the last 365 days vs best of the 365 days before; null when either window is empty. */
  deltaPct: number | null;
  /** True when going DOWN is better (pace). */
  invert: boolean;
  /** Established within the last 90 days. */
  recent: boolean;
}

/** Minimum distance for average pace/speed records, per sport family. */
const MIN_PACE_DISTANCE_M = 5000;
const MIN_SPEED_DISTANCE_M = 20000;

interface Candidate {
  workout: WorkoutLite;
  value: number;
}

function betterOf(a: Candidate, b: Candidate, lowerIsBetter: boolean): Candidate {
  if (lowerIsBetter) return b.value < a.value ? b : a;
  return b.value > a.value ? b : a;
}

function buildRecord(
  kind: RecordKind,
  activityType: string,
  candidates: Candidate[],
  lowerIsBetter: boolean,
  now: Date
): SportRecord | null {
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => betterOf(a, b, lowerIsBetter));

  const byYear = new Map<number, number>();
  for (const c of candidates) {
    const year = c.workout.startTs.getUTCFullYear();
    const prev = byYear.get(year);
    if (prev === undefined || (lowerIsBetter ? c.value < prev : c.value > prev)) {
      byYear.set(year, c.value);
    }
  }
  const years = [...byYear.keys()];
  const firstYear = Math.min(...years);
  const lastYear = now.getUTCFullYear();
  const progression: SportRecord['progression'] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    progression.push({ year: y, value: byYear.get(y) ?? null });
  }

  const yearMs = 365 * 86_400_000;
  const last365 = candidates.filter((c) => now.getTime() - c.workout.startTs.getTime() < yearMs);
  const prev365 = candidates.filter((c) => {
    const age = now.getTime() - c.workout.startTs.getTime();
    return age >= yearMs && age < 2 * yearMs;
  });
  let deltaPct: number | null = null;
  if (last365.length > 0 && prev365.length > 0) {
    const bl = last365.reduce((a, b) => betterOf(a, b, lowerIsBetter)).value;
    const bp = prev365.reduce((a, b) => betterOf(a, b, lowerIsBetter)).value;
    if (bp !== 0) deltaPct = ((bl - bp) / Math.abs(bp)) * 100;
  }

  return {
    kind,
    activityType,
    workoutId: best.workout.id,
    date: best.workout.startTs,
    value: best.value,
    progression,
    deltaPct,
    invert: lowerIsBetter,
    recent: now.getTime() - best.workout.startTs.getTime() < 90 * 86_400_000,
  };
}

/** All simple records for one sport. */
export function sportRecords(workouts: WorkoutLite[], activityType: string, now: Date): SportRecord[] {
  const ofSport = workouts.filter((w) => w.activityType === activityType);
  if (ofSport.length === 0) return [];
  const out: SportRecord[] = [];

  const withDistance = ofSport.filter((w): w is WorkoutLite & { distanceM: number } => w.distanceM !== null && w.distanceM > 0);
  const dist = buildRecord(
    'longest_distance',
    activityType,
    withDistance.map((w) => ({ workout: w, value: w.distanceM })),
    false,
    now
  );
  if (dist) out.push(dist);

  const dur = buildRecord(
    'longest_duration',
    activityType,
    ofSport.map((w) => ({ workout: w, value: w.durationS })),
    false,
    now
  );
  if (dur) out.push(dur);

  const paceable = withDistance.filter((w) => w.distanceM >= MIN_PACE_DISTANCE_M && w.durationS > 0);
  const pace = buildRecord(
    'best_pace',
    activityType,
    paceable.map((w) => ({ workout: w, value: w.durationS / (w.distanceM / 1000) })),
    true,
    now
  );
  const speedable = withDistance.filter((w) => w.distanceM >= MIN_SPEED_DISTANCE_M && w.durationS > 0);
  const speed = buildRecord(
    'best_speed',
    activityType,
    speedable.map((w) => ({ workout: w, value: w.distanceM / 1000 / (w.durationS / 3600) })),
    false,
    now
  );
  // Pace reads naturally for foot sports, speed for wheeled ones.
  if (activityType === 'HKWorkoutActivityTypeCycling') {
    if (speed) out.push(speed);
  } else if (pace) {
    out.push(pace);
  }

  const climbs = ofSport.filter((w): w is WorkoutLite & { elevationUpM: number } => w.elevationUpM !== null && w.elevationUpM > 0);
  const climb = buildRecord(
    'biggest_climb',
    activityType,
    climbs.map((w) => ({ workout: w, value: w.elevationUpM })),
    false,
    now
  );
  if (climb) out.push(climb);

  return out;
}

/** One session's record candidates, mirroring sportRecords' rules exactly. */
function candidatesOf(w: WorkoutLite): Array<{ kind: RecordKind; value: number; lowerIsBetter: boolean }> {
  const out: Array<{ kind: RecordKind; value: number; lowerIsBetter: boolean }> = [];
  const distance = w.distanceM !== null && w.distanceM > 0 ? w.distanceM : null;
  if (distance !== null) out.push({ kind: 'longest_distance', value: distance, lowerIsBetter: false });
  if (w.durationS > 0) out.push({ kind: 'longest_duration', value: w.durationS, lowerIsBetter: false });
  if (distance !== null && w.durationS > 0) {
    // Pace reads naturally for foot sports, speed for wheeled ones.
    if (w.activityType === 'HKWorkoutActivityTypeCycling') {
      if (distance >= MIN_SPEED_DISTANCE_M) {
        out.push({ kind: 'best_speed', value: distance / 1000 / (w.durationS / 3600), lowerIsBetter: false });
      }
    } else if (distance >= MIN_PACE_DISTANCE_M) {
      out.push({ kind: 'best_pace', value: w.durationS / (distance / 1000), lowerIsBetter: true });
    }
  }
  if (w.elevationUpM !== null && w.elevationUpM > 0) {
    out.push({ kind: 'biggest_climb', value: w.elevationUpM, lowerIsBetter: false });
  }
  return out;
}

/** A record that was actually beaten on a given day, with the mark it replaced. */
export interface RecordEvent {
  kind: RecordKind;
  activityType: string;
  workoutId: string;
  ts: Date;
  value: number;
  /** The best that stood until this session. */
  previous: number;
  invert: boolean;
}

/**
 * Records broken during a window, replayed chronologically over the whole
 * history: the running best per (sport, kind) is what makes an improvement a
 * record, so the full list is needed even to answer about three days.
 * A sport's first session is NOT an event (it beats nothing); only a mark
 * that replaces an existing one counts. `keep` filters on the event date,
 * which the caller resolves in the subject's timezone.
 */
export function recordEvents(workouts: WorkoutLite[], keep: (ts: Date) => boolean): RecordEvent[] {
  const best = new Map<string, number>();
  const out: RecordEvent[] = [];
  const chronological = [...workouts].sort((a, b) => a.startTs.getTime() - b.startTs.getTime());

  for (const w of chronological) {
    for (const c of candidatesOf(w)) {
      const key = `${w.activityType}|${c.kind}`;
      const previous = best.get(key);
      const better =
        previous === undefined || (c.lowerIsBetter ? c.value < previous : c.value > previous);
      if (!better) continue;
      best.set(key, c.value);
      if (previous !== undefined && keep(w.startTs)) {
        out.push({
          kind: c.kind,
          activityType: w.activityType,
          workoutId: w.id,
          ts: w.startTs,
          value: c.value,
          previous,
          invert: c.lowerIsBetter,
        });
      }
    }
  }
  return out;
}
