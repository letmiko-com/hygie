// Shared session primitives, used by the Auth.js adapter, the proxy and the
// server pages. The cookie carries the RAW session token; the database stores
// only its sha256 (db/migrations/0001: auth_sessions.token is a hash), so a
// database leak cannot be replayed as a session.
import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';

/** sha256 hex of a raw token (session tokens; verification tokens are hashed by Auth.js core). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function secureCookiesEnabled(): boolean {
  return (process.env.HYGIE_BASE_URL ?? '').startsWith('https://');
}

/**
 * Single source of truth for the session cookie name (auth config AND proxy):
 * the __Secure- prefix follows the deployment scheme derived from HYGIE_BASE_URL.
 */
export function sessionCookieName(): string {
  return secureCookiesEnabled() ? '__Secure-hygie.session-token' : 'hygie.session-token';
}

export function sessionCookieSecure(): boolean {
  return secureCookiesEnabled();
}

/**
 * Real (database) check used by the proxy: the session exists, is not expired,
 * and its user is not disabled. Immediate revocation = deleting the row.
 */
export async function isValidSession(rawToken: string): Promise<boolean> {
  const { rows } = await getDb().query(
    `select 1
       from auth_sessions s
       join users u on u.id = s.user_id
      where s.token = $1
        and s.expires_at > now()
        and u.disabled_at is null`,
    [hashToken(rawToken)]
  );
  return rows.length > 0;
}
