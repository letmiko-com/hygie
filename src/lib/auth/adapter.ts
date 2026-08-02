// Explicit Auth.js adapter mapped onto Hygie's own tables (db/migrations/0001):
// users, auth_sessions, auth_verification_tokens. Nothing is implicit: no
// accounts table (email provider only), no implicit user creation (no public
// signup: createUser throws; the signIn callback denies unknown emails before
// core ever reaches it).
//
// Hashing contract:
// - verification tokens arrive here ALREADY hashed by @auth/core
//   (sha256(`${token}${secret}`) in lib/actions/signin/send-token.js);
// - session tokens arrive RAW (they live in the cookie); this adapter stores
//   sha256(raw) so auth_sessions.token is a hash, per the schema comment.
import type { Adapter, AdapterSession, AdapterUser, VerificationToken } from 'next-auth/adapters';
import { getDb } from '@/lib/db';
import { hashToken } from '@/lib/auth/session';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
}

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    // Not persisted: membership is by admin invitation, addresses are trusted
    // at creation. Auth.js sets it after each verification; updateUser ignores it.
    emailVerified: null,
  };
}

const USER_COLS = 'id, email, display_name, is_admin';

export function hygieAdapter(): Adapter {
  return {
    async createUser() {
      // No public signup. The signIn callback refuses unknown emails, so the
      // email flow never reaches this branch; keep it as a hard stop anyway.
      throw new Error('public signup is disabled');
    },

    async getUser(id) {
      const { rows } = await getDb().query<UserRow>(
        `select ${USER_COLS} from users where id = $1 and disabled_at is null`,
        [id]
      );
      return rows[0] ? toAdapterUser(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const { rows } = await getDb().query<UserRow>(
        `select ${USER_COLS} from users where email = $1 and disabled_at is null`,
        [email]
      );
      return rows[0] ? toAdapterUser(rows[0]) : null;
    },

    async getUserByAccount() {
      return null; // email provider only, no accounts table
    },

    async updateUser(user) {
      // The email flow only pushes emailVerified updates, which Hygie does not
      // persist. Apply the fields our schema knows, return the current row.
      const { rows } = await getDb().query<UserRow>(
        `update users
            set email        = coalesce($2, email),
                display_name = coalesce($3, display_name)
          where id = $1
          returning ${USER_COLS}`,
        [user.id, user.email ?? null, user.name ?? null]
      );
      if (!rows[0]) throw new Error('updateUser: user not found');
      return toAdapterUser(rows[0]);
    },

    async deleteUser(id) {
      await getDb().query('delete from users where id = $1', [id]);
    },

    async linkAccount() {
      return undefined; // no accounts table
    },

    async unlinkAccount() {
      return undefined;
    },

    async createSession(session): Promise<AdapterSession> {
      await getDb().query(
        'insert into auth_sessions (token, user_id, expires_at) values ($1, $2, $3)',
        [hashToken(session.sessionToken), session.userId, session.expires]
      );
      return session;
    },

    async getSessionAndUser(sessionToken) {
      const { rows } = await getDb().query<UserRow & { user_id: string; expires_at: Date }>(
        `select s.user_id, s.expires_at, u.id, u.email, u.display_name, u.is_admin
           from auth_sessions s
           join users u on u.id = s.user_id
          where s.token = $1
            and u.disabled_at is null`,
        [hashToken(sessionToken)]
      );
      const row = rows[0];
      if (!row) return null;
      // Expired sessions are returned as-is: @auth/core compares expires itself
      // and calls deleteSession (the proxy filters on expires_at > now()).
      return {
        session: { sessionToken, userId: row.user_id, expires: row.expires_at },
        user: toAdapterUser(row),
      };
    },

    async updateSession(session): Promise<AdapterSession | null> {
      const { rows } = await getDb().query<{ user_id: string; expires_at: Date }>(
        `update auth_sessions
            set expires_at = coalesce($2, expires_at)
          where token = $1
          returning user_id, expires_at`,
        [hashToken(session.sessionToken), session.expires ?? null]
      );
      const row = rows[0];
      if (!row) return null;
      return { sessionToken: session.sessionToken, userId: row.user_id, expires: row.expires_at };
    },

    async deleteSession(sessionToken) {
      await getDb().query('delete from auth_sessions where token = $1', [
        hashToken(sessionToken),
      ]);
    },

    async createVerificationToken(token): Promise<VerificationToken> {
      await getDb().query(
        'insert into auth_verification_tokens (identifier, token, expires_at) values ($1, $2, $3)',
        [token.identifier, token.token, token.expires]
      );
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      // Single-use: DELETE ... RETURNING consumes atomically.
      const { rows } = await getDb().query<{ identifier: string; token: string; expires_at: Date }>(
        `delete from auth_verification_tokens
          where identifier = $1 and token = $2
          returning identifier, token, expires_at`,
        [identifier, token]
      );
      const row = rows[0];
      if (!row) return null;
      return { identifier: row.identifier, token: row.token, expires: row.expires_at };
    },
  };
}
