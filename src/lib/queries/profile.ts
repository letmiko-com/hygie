// The signed-in account's own profile: its name, its language, and the time
// zone of the subject it owns. Every function takes the SessionUser derived
// from the session, never a free user id: an account edits itself only.
//
// One name (decision of 2026-10-04): the account's display name and the name
// of the subject it owns change together. It is the name shown in the sidebar
// and the one the admin sees in the member list.
import { getDb, withTransaction } from '@/lib/db';
import type { SessionUser } from './context';

export interface OwnedSubject {
  id: string;
  name: string;
  /** IANA zone: cuts the subject's days, nights and totals. */
  timezone: string;
}

export interface Profile {
  name: string;
  email: string;
  locale: 'fr' | 'en';
  /** The subject this account owns, when it owns one (a pure admin does not). */
  subject: OwnedSubject | null;
}

/**
 * Same subject as getSubjectContext() picks: the oldest live subject the
 * account holds a grant on, here restricted to the owner role.
 */
async function ownedSubject(userId: string): Promise<OwnedSubject | null> {
  const { rows } = await getDb().query<{ id: string; display_name: string; timezone: string }>(
    `select s.id, s.display_name, s.timezone
     from access_grants g
     join subjects s on s.id = g.subject_id and s.purge_state = 'live'
     where g.user_id = $1 and g.role = 'owner'
     order by s.created_at
     limit 1`,
    [userId]
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.display_name, timezone: r.timezone } : null;
}

export async function getProfile(user: SessionUser): Promise<Profile> {
  return {
    name: user.displayName,
    email: user.email,
    locale: user.locale === 'en' ? 'en' : 'fr',
    subject: await ownedSubject(user.userId),
  };
}

/** True when Postgres knows the zone: it cuts the days with `at time zone`. */
export async function isKnownTimezone(tz: string): Promise<boolean> {
  const { rows } = await getDb().query<{ known: boolean }>(
    'select exists (select 1 from pg_timezone_names where name = $1) as known',
    [tz]
  );
  return rows[0]?.known ?? false;
}

export interface ProfileUpdate {
  name: string;
  locale: 'fr' | 'en';
  /** Ignored when the account owns no subject. */
  timezone: string | null;
}

export async function updateProfile(user: SessionUser, update: ProfileUpdate): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `update users set display_name = $2, locale = $3 where id = $1 and disabled_at is null`,
      [user.userId, update.name, update.locale]
    );
    // Only the subject this account owns, through its own grant.
    await client.query(
      `update subjects s
          set display_name = $2,
              timezone = coalesce($3, s.timezone)
        where s.purge_state = 'live'
          and s.id = (select g.subject_id from access_grants g
                       join subjects o on o.id = g.subject_id and o.purge_state = 'live'
                      where g.user_id = $1 and g.role = 'owner'
                      order by o.created_at
                      limit 1)`,
      [user.userId, update.name, update.timezone]
    );
  });
}
