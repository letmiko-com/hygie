// Subject context: the single entry point that turns a session into a data
// scope. Every read function in this layer takes a SubjectContext, never a
// free subject id — the admin/health boundary is structural (architecture §1):
// an account without a grant (the pure admin case) gets null and therefore
// cannot reach any health data through this layer.
import { auth } from '@/auth';
import { getDb } from '@/lib/db';

export type SubjectRole = 'owner';

export interface SubjectContext {
  userId: string;
  isAdmin: boolean;
  subjectId: string;
  role: SubjectRole;
  /** IANA zone from subjects.timezone: cuts days, nights and rollups. */
  timezone: string;
  subjectName: string;
  /** UI preferences from users.* */
  locale: string;
  unitSystem: 'metric' | 'imperial';
  weekStart: number;
}

interface ContextRow {
  user_id: string;
  is_admin: boolean;
  subject_id: string;
  role: SubjectRole;
  timezone: string;
  display_name: string;
  locale: string;
  unit_system: 'metric' | 'imperial';
  week_start: number;
}

/**
 * Resolves the current session to its granted subject, or null when the
 * session is absent, the user is disabled, or no live subject is granted.
 * MVP: one account = one subject; with several grants the oldest subject
 * wins deterministically (a subject switcher comes with the family phase).
 */
export async function getSubjectContext(): Promise<SubjectContext | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const { rows } = await getDb().query<ContextRow>(
    `select u.id as user_id, u.is_admin, u.locale, u.unit_system, u.week_start,
            g.subject_id, g.role, s.timezone, s.display_name
     from users u
     join access_grants g on g.user_id = u.id
     join subjects s on s.id = g.subject_id and s.purge_state = 'live'
     where u.email = $1 and u.disabled_at is null
     order by s.created_at
     limit 1`,
    [email]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    isAdmin: row.is_admin,
    subjectId: row.subject_id,
    role: row.role,
    timezone: row.timezone,
    subjectName: row.display_name,
    locale: row.locale,
    unitSystem: row.unit_system,
    weekStart: row.week_start,
  };
}
