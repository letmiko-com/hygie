// Workout reads. Session heart rate comes from the raw HeartRate
// observations between the workout bounds: the HAE workout_points carry no
// heart rate by design (hae-mapping.md: heartRateData is the post-workout
// recovery window, never ingested as session HR). Several sources can write
// HR on the same interval (watch + BT chest strap): series are returned per
// source, never silently averaged.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { getMetricType } from './metric-types';
import { heavyRead } from './read';
import type { DayRange } from './time';

export interface WorkoutListItem {
  id: string;
  activityType: string;
  sourceName: string;
  startTs: Date;
  endTs: Date;
  tzOffsetMin: number;
  isIndoor: boolean | null;
  durationS: number;
  distanceM: number | null;
  energyKj: number | null;
  /** Average session HR from raw observations; null when none were recorded. */
  avgHrBpm: number | null;
}

export interface WorkoutDetail extends WorkoutListItem {
  elevationUpM: number | null;
  stats: Record<string, unknown>;
  hasRoute: boolean;
}

interface WorkoutRow {
  id: string;
  activity_type: string;
  source_name: string;
  start_ts: Date;
  end_ts: Date;
  tz_offset_min: number;
  is_indoor: boolean | null;
  duration_s: number;
  distance_m: number | null;
  energy_kj: number | null;
  avg_hr_bpm: number | null;
}

function mapItem(r: WorkoutRow): WorkoutListItem {
  return {
    id: r.id,
    activityType: r.activity_type,
    sourceName: r.source_name,
    startTs: r.start_ts,
    endTs: r.end_ts,
    tzOffsetMin: r.tz_offset_min,
    isIndoor: r.is_indoor,
    durationS: r.duration_s,
    distanceM: r.distance_m,
    energyKj: r.energy_kj,
    avgHrBpm: r.avg_hr_bpm,
  };
}

/** Per-row lateral avg HR: one index range probe per workout, measured in ms. */
const AVG_HR_LATERAL = `
  cross join lateral (
    select avg(o.value) as avg_hr_bpm
    from observations o
    where o.subject_id = w.subject_id and o.type_id = $2
      and o.start_ts >= w.start_ts and o.start_ts < w.end_ts
  ) hr`;

export async function workoutsInRange(
  ctx: SubjectContext,
  range: DayRange,
  activityType?: string
): Promise<WorkoutListItem[]> {
  const hrType = await getMetricType('HKQuantityTypeIdentifierHeartRate');
  const params: unknown[] = [ctx.subjectId, hrType.id, range.fromDay, range.toDayExcl, ctx.timezone];
  let filter = '';
  if (activityType) {
    params.push(activityType);
    filter = `and w.activity_type = $${params.length}`;
  }
  const rows = await heavyRead<WorkoutRow>(
    `select w.id, w.activity_type, s.name as source_name, w.start_ts, w.end_ts,
            w.tz_offset_min, w.is_indoor, w.duration_s, w.distance_m, w.energy_kj,
            hr.avg_hr_bpm
     from workouts w
     join sources s on s.id = w.source_id
     ${AVG_HR_LATERAL}
     where w.subject_id = $1
       and w.start_ts >= ($3::date::timestamp at time zone $5)
       and w.start_ts < ($4::date::timestamp at time zone $5)
       ${filter}
     order by w.start_ts desc`,
    params
  );
  return rows.map(mapItem);
}

export interface WorkoutSummary {
  count: number;
  totalDurationS: number;
  totalDistanceM: number | null;
  totalEnergyKj: number | null;
  avgHrBpm: number | null;
}

export async function workoutSummary(
  ctx: SubjectContext,
  range: DayRange,
  activityType?: string
): Promise<WorkoutSummary> {
  const hrType = await getMetricType('HKQuantityTypeIdentifierHeartRate');
  const params: unknown[] = [ctx.subjectId, hrType.id, range.fromDay, range.toDayExcl, ctx.timezone];
  let filter = '';
  if (activityType) {
    params.push(activityType);
    filter = `and w.activity_type = $${params.length}`;
  }
  interface Row {
    count: number;
    total_duration_s: number | null;
    total_distance_m: number | null;
    total_energy_kj: number | null;
    avg_hr_bpm: number | null;
  }
  const rows = await heavyRead<Row>(
    `select count(*)::int as count,
            sum(w.duration_s) as total_duration_s,
            sum(w.distance_m) as total_distance_m,
            sum(w.energy_kj) as total_energy_kj,
            avg(hr.avg_hr_bpm) as avg_hr_bpm
     from workouts w
     ${AVG_HR_LATERAL}
     where w.subject_id = $1
       and w.start_ts >= ($3::date::timestamp at time zone $5)
       and w.start_ts < ($4::date::timestamp at time zone $5)
       ${filter}`,
    params
  );
  const r = rows[0];
  return {
    count: r?.count ?? 0,
    totalDurationS: r?.total_duration_s ?? 0,
    totalDistanceM: r?.total_distance_m ?? null,
    totalEnergyKj: r?.total_energy_kj ?? null,
    avgHrBpm: r?.avg_hr_bpm ?? null,
  };
}

/** Workouts per activity type over a range (list screen tab counters). */
export async function workoutCountsByActivity(
  ctx: SubjectContext,
  range: DayRange
): Promise<Array<{ activityType: string; count: number }>> {
  interface Row {
    activity_type: string;
    count: number;
  }
  const { rows } = await getDb().query<Row>(
    `select w.activity_type, count(*)::int as count
     from workouts w
     where w.subject_id = $1
       and w.start_ts >= ($2::date::timestamp at time zone $4)
       and w.start_ts < ($3::date::timestamp at time zone $4)
     group by 1 order by count desc, activity_type`,
    [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone]
  );
  return rows.map((r) => ({ activityType: r.activity_type, count: r.count }));
}

/** Re-filters on subject_id: cross-subject leaks must be structurally impossible. */
export async function getWorkout(ctx: SubjectContext, workoutId: string): Promise<WorkoutDetail | null> {
  const hrType = await getMetricType('HKQuantityTypeIdentifierHeartRate');
  interface Row extends WorkoutRow {
    elevation_up_m: number | null;
    stats: Record<string, unknown>;
    has_route: boolean;
  }
  const { rows } = await getDb().query<Row>(
    `select w.id, w.activity_type, s.name as source_name, w.start_ts, w.end_ts,
            w.tz_offset_min, w.is_indoor, w.duration_s, w.distance_m, w.energy_kj,
            w.elevation_up_m, w.stats, hr.avg_hr_bpm,
            exists (select 1 from workout_route_points rp where rp.workout_id = w.id) as has_route
     from workouts w
     join sources s on s.id = w.source_id
     ${AVG_HR_LATERAL}
     where w.subject_id = $1 and w.id = $3`,
    [ctx.subjectId, hrType.id, workoutId]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...mapItem(r), elevationUpM: r.elevation_up_m, stats: r.stats, hasRoute: r.has_route };
}

export interface WorkoutHrSeries {
  sourceName: string;
  samples: Array<{ ts: Date; bpm: number }>;
}

/**
 * Raw HR samples inside the workout window, grouped by source, largest
 * series first. Empty array when no HR was recorded (never invented).
 */
export async function workoutHeartRate(ctx: SubjectContext, workoutId: string): Promise<WorkoutHrSeries[]> {
  const hrType = await getMetricType('HKQuantityTypeIdentifierHeartRate');
  interface Row {
    source_name: string;
    ts: Date;
    bpm: number;
  }
  const { rows } = await getDb().query<Row>(
    `select s.name as source_name, o.start_ts as ts, o.value as bpm
     from workouts w
     join observations o
       on o.subject_id = w.subject_id and o.type_id = $3
      and o.start_ts >= w.start_ts and o.start_ts < w.end_ts
     join sources s on s.id = o.source_id
     where w.subject_id = $1 and w.id = $2
     order by s.name, o.start_ts`,
    [ctx.subjectId, workoutId, hrType.id]
  );
  const bySource = new Map<string, WorkoutHrSeries>();
  for (const r of rows) {
    let series = bySource.get(r.source_name);
    if (!series) {
      series = { sourceName: r.source_name, samples: [] };
      bySource.set(r.source_name, series);
    }
    series.samples.push({ ts: r.ts, bpm: r.bpm });
  }
  return [...bySource.values()].sort((a, b) => b.samples.length - a.samples.length);
}

export interface WorkoutSeriesPoint {
  ts: Date;
  value: number;
}

/** One minute-series from workout_points ('active_energy', 'step_count', ...). */
export async function workoutSeries(
  ctx: SubjectContext,
  workoutId: string,
  series: string
): Promise<WorkoutSeriesPoint[]> {
  interface Row {
    ts: Date;
    value: number;
  }
  const { rows } = await getDb().query<Row>(
    `select p.ts, p.value
     from workouts w
     join workout_points p on p.workout_id = w.id and p.series = $3
     where w.subject_id = $1 and w.id = $2
     order by p.ts`,
    [ctx.subjectId, workoutId, series]
  );
  return rows;
}

export interface WorkoutSplit {
  km: number;
  durationS: number;
}

/**
 * Kilometer splits from the cumulative per-minute distance series, stored in
 * meters (HAE workouts only). Null when the series is absent — no splits is
 * not the same as zero splits.
 */
export async function workoutSplits(ctx: SubjectContext, workoutId: string): Promise<WorkoutSplit[] | null> {
  const points = await workoutSeries(ctx, workoutId, 'walking_running_distance');
  if (points.length === 0) return null;

  const splits: WorkoutSplit[] = [];
  let cumulativeM = 0;
  let lastBoundaryMs = points[0].ts.getTime();
  let nextBoundaryM = 1000;

  for (const p of points) {
    const beforeM = cumulativeM;
    cumulativeM += p.value;
    while (cumulativeM >= nextBoundaryM) {
      // Interpolate the crossing time inside this minute bucket.
      const frac = p.value > 0 ? (nextBoundaryM - beforeM) / p.value : 1;
      const crossingMs = p.ts.getTime() + frac * 60_000;
      splits.push({
        km: nextBoundaryM / 1000,
        durationS: Math.round((crossingMs - lastBoundaryMs) / 1000),
      });
      lastBoundaryMs = crossingMs;
      nextBoundaryM += 1000;
    }
  }
  return splits.length > 0 ? splits : null;
}
