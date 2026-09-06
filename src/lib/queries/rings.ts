// Activity rings (activity_summaries): one row per device-calendar day,
// written by the native channel and the XML backfill. Read scoped by subject
// like every other query; a missing day is a missing day, never zeros.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';

export interface RingsDay {
  day: string;
  moveMode: 'energy' | 'time';
  moveKj: number | null;
  moveGoalKj: number | null;
  moveTimeMin: number | null;
  moveTimeGoalMin: number | null;
  exerciseMin: number | null;
  exerciseGoalMin: number | null;
  standH: number | null;
  standGoalH: number | null;
  paused: boolean;
}

interface Row {
  day: string;
  move_mode: 'energy' | 'time';
  move_kj: number | null;
  move_goal_kj: number | null;
  move_time_min: number | null;
  move_time_goal_min: number | null;
  exercise_min: number | null;
  exercise_goal_min: number | null;
  stand_h: number | null;
  stand_goal_h: number | null;
  paused: boolean;
}

/** Days between fromDay and toDayIncl (both inclusive, ISO yyyy-mm-dd), ascending. */
export async function activityRings(
  ctx: SubjectContext,
  fromDay: string,
  toDayIncl: string
): Promise<RingsDay[]> {
  const { rows } = await getDb().query<Row>(
    `select to_char(day, 'YYYY-MM-DD') as day, move_mode, move_kj, move_goal_kj,
            move_time_min, move_time_goal_min, exercise_min, exercise_goal_min,
            stand_h, stand_goal_h, paused
     from activity_summaries
     where subject_id = $1 and day between $2::date and $3::date
     order by day`,
    [ctx.subjectId, fromDay, toDayIncl]
  );
  return rows.map((r) => ({
    day: r.day,
    moveMode: r.move_mode,
    moveKj: r.move_kj,
    moveGoalKj: r.move_goal_kj,
    moveTimeMin: r.move_time_min,
    moveTimeGoalMin: r.move_time_goal_min,
    exerciseMin: r.exercise_min,
    exerciseGoalMin: r.exercise_goal_min,
    standH: r.stand_h,
    standGoalH: r.stand_goal_h,
    paused: r.paused,
  }));
}
