// The signed-in account's own profile: its name, its language, and the time
// zone of the subject it owns. Every function takes the SessionUser derived
// from the session, never a free user id: an account edits itself only.
//
// One name (decision of 2026-10-04): the account's display name and the name
// of the subject it owns change together. It is the name shown in the sidebar
// and the one the admin sees in the member list.
import { getDb, withTransaction } from '@/lib/db';
import type { EmailChangeClaim } from '@/lib/auth/email-change';
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
  /** ISO weekday the account's weeks start on (users.week_start, 1 = Monday). */
  weekStart: number;
  /** Display units (users.unit_system); the database stays metric. */
  unitSystem: 'metric' | 'imperial';
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
  const [subject, prefs] = await Promise.all([
    ownedSubject(user.userId),
    getDb().query<{ week_start: number; unit_system: 'metric' | 'imperial' }>(
      'select week_start, unit_system from users where id = $1',
      [user.userId]
    ),
  ]);
  return {
    name: user.displayName,
    email: user.email,
    locale: user.locale === 'en' ? 'en' : 'fr',
    weekStart: prefs.rows[0]?.week_start ?? 1,
    unitSystem: prefs.rows[0]?.unit_system ?? 'metric',
    subject,
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
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekStart: number;
  unitSystem: 'metric' | 'imperial';
  /** Ignored when the account owns no subject. */
  timezone: string | null;
}

export async function updateProfile(user: SessionUser, update: ProfileUpdate): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `update users set display_name = $2, locale = $3, week_start = $4, unit_system = $5
        where id = $1 and disabled_at is null`,
      [user.userId, update.name, update.locale, update.weekStart, update.unitSystem]
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

/** True when an account (enabled or not) already uses the address: users.email is unique. */
export async function emailTaken(email: string): Promise<boolean> {
  const { rows } = await getDb().query<{ taken: boolean }>(
    'select exists (select 1 from users where email = $1) as taken',
    [email]
  );
  return rows[0]?.taken ?? false;
}

/** The account a verified email change token names, for the confirmation page. */
export async function emailChangeAccount(claim: EmailChangeClaim): Promise<{ name: string; locale: string } | null> {
  const { rows } = await getDb().query<{ display_name: string; locale: string }>(
    'select display_name, locale from users where id = $1 and email = $2 and disabled_at is null',
    [claim.userId, claim.from]
  );
  return rows[0] ? { name: rows[0].display_name, locale: rows[0].locale } : null;
}

export type EmailChangeOutcome = 'changed' | 'stale' | 'taken';

const UNIQUE_VIOLATION = '23505';

/**
 * Applies a verified email change. `stale` when the account's address is no
 * longer the one the token was issued for (already applied, changed since,
 * account disabled): that is what makes a token single use.
 *
 * Then every session of the account is closed except `keepSessionHash`, the
 * one confirming, when it belongs to that account; and pending sign-in links
 * of the old address are dropped.
 */
export async function applyEmailChange(
  claim: EmailChangeClaim,
  keepSessionHash: string | null
): Promise<EmailChangeOutcome> {
  try {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `update users set email = $3 where id = $1 and email = $2 and disabled_at is null`,
        [claim.userId, claim.from, claim.to]
      );
      if ((res.rowCount ?? 0) === 0) return 'stale' as const;
      await client.query(
        `delete from auth_sessions where user_id = $1 and token is distinct from $2`,
        [claim.userId, keepSessionHash]
      );
      await client.query('delete from auth_verification_tokens where identifier = $1', [claim.from]);
      return 'changed' as const;
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return 'taken';
    }
    throw err;
  }
}

/** True when the session (by its stored hash) belongs to the account. */
export async function sessionBelongsTo(sessionHash: string, userId: string): Promise<boolean> {
  const { rows } = await getDb().query<{ mine: boolean }>(
    'select exists (select 1 from auth_sessions where token = $1 and user_id = $2) as mine',
    [sessionHash, userId]
  );
  return rows[0]?.mine ?? false;
}
