// Per-subject settings that are not measures (migration 0005). One row per
// subject, written on first save; no row means nothing declared. Read by the
// subject's own screens only: the context carries the subject the session is
// entitled to, nothing else is ever addressed.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';

export interface SubjectSettings {
  /** Declared maximum heart rate, null when the subject never set one. */
  maxHrBpm: number | null;
  updatedAt: Date | null;
}

export const MAX_HR_MIN = 100;
export const MAX_HR_MAX = 230;

export async function getSubjectSettings(ctx: SubjectContext): Promise<SubjectSettings> {
  const { rows } = await getDb().query<{ max_hr_bpm: number | null; updated_at: Date }>(
    'select max_hr_bpm, updated_at from subject_settings where subject_id = $1',
    [ctx.subjectId]
  );
  const row = rows[0];
  return row ? { maxHrBpm: row.max_hr_bpm, updatedAt: row.updated_at } : { maxHrBpm: null, updatedAt: null };
}

/** Sets or clears (null) the declared maximum; the range is the table's check constraint. */
export async function setDeclaredMaxHr(ctx: SubjectContext, bpm: number | null): Promise<void> {
  if (bpm !== null && (!Number.isInteger(bpm) || bpm < MAX_HR_MIN || bpm > MAX_HR_MAX)) {
    throw new Error('max HR out of range');
  }
  await getDb().query(
    `insert into subject_settings (subject_id, max_hr_bpm, updated_at)
     values ($1, $2, now())
     on conflict (subject_id) do update set max_hr_bpm = excluded.max_hr_bpm, updated_at = now()`,
    [ctx.subjectId, bpm]
  );
}
