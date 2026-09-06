// Auth.js v5, magic link only (docs/architecture.md §5).
// - Database sessions on our own tables via the explicit adapter: revocation is
//   a DELETE, immediately effective (no self-contained JWT).
// - No public signup: the signIn callback refuses any email that does not match
//   an active user, and the login action refuses to even send in that case.
// - The email carries a link to /login/verify (harmless GET); the token is only
//   consumed by the POST that page submits to /api/auth/callback/nodemailer
//   (@auth/core reads token/email from the query string; CSRF is only enforced
//   for credentials providers, verified against @auth/core 0.41 source).
import { createHash } from 'node:crypto';
import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { hygieAdapter } from '@/lib/auth/adapter';
import { sendMagicLinkEmail } from '@/lib/auth/mailer';
import { getDb } from '@/lib/db';
import { sessionCookieName, sessionCookieSecure } from '@/lib/auth/session';

export const MAGIC_LINK_MAX_AGE_S = 15 * 60; // « valable 15 minutes » (maquette Login)
/**
 * One email per address per minute (pentest 2026-08-30, F1): Auth.js inserts
 * the token before asking us to send, so a second token younger than this for
 * the same address is a flood, and nothing is sent for it.
 */
export const MAGIC_LINK_COOLDOWN_S = 60;

// Deterministic origin: HYGIE_BASE_URL is the instance's canonical URL
// (.env.example), let Auth.js use it instead of sniffing Host headers.
if (!process.env.AUTH_URL && process.env.HYGIE_BASE_URL) {
  process.env.AUTH_URL = new URL('/api/auth', process.env.HYGIE_BASE_URL).toString();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: hygieAdapter(),
  session: { strategy: 'database' },
  trustHost: true,
  useSecureCookies: sessionCookieSecure(),
  cookies: {
    sessionToken: {
      name: sessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: sessionCookieSecure(),
      },
    },
  },
  pages: {
    signIn: '/login',
    verifyRequest: '/login/sent',
    error: '/login', // rendered as a sober notice by the login page (?error=...)
  },
  providers: [
    Nodemailer({
      // Never used: sendVerificationRequest below owns the transport. The
      // provider factory only insists that `server` exists at module load.
      server: { jsonTransport: true },
      maxAge: MAGIC_LINK_MAX_AGE_S,
      async sendVerificationRequest({ identifier, url, token }) {
        // Two gates before any email leaves, both silent (pentest 2026-08-30):
        // - F2: an unknown or disabled address gets no email. The signIn
        //   callback lets the request through so the native endpoint answers
        //   /login/sent for everyone; the token row expires unused and the
        //   worker's maintenance purges it.
        // - F1: another token younger than MAGIC_LINK_COOLDOWN_S for the same
        //   address means a flood. @auth/core inserts this request's token IN
        //   PARALLEL with this call (Promise.all in send-token.js), so it may
        //   or may not be there yet: it is excluded by its stored form,
        //   sha256(token + secret) hex, exactly as @auth/core hashes it.
        const current = createHash('sha256')
          .update(`${token}${process.env.AUTH_SECRET ?? ''}`)
          .digest('hex');
        const { rows } = await getDb().query<{ known: boolean; recent: number }>(
          `select exists (select 1 from users where email = $1 and disabled_at is null) as known,
                  (select count(*)::int from auth_verification_tokens
                    where identifier = $1 and token <> $3
                      and expires_at > now() + ($2::int * interval '1 second')) as recent`,
          [identifier, MAGIC_LINK_MAX_AGE_S - MAGIC_LINK_COOLDOWN_S, current]
        );
        const gate = rows[0];
        if (!gate?.known) return;
        if (gate.recent > 0) {
          // Count only: no address in the logs.
          console.warn('[auth] magic link throttled: a link was sent to this address less than a minute ago');
          return;
        }
        // `url` is the direct consuming callback; the email must NOT contain
        // it. Point to the confirmation page instead, same query string
        // (token, email, callbackUrl): mailbox link scanners GET that page
        // and consume nothing.
        const original = new URL(url);
        const base = process.env.HYGIE_BASE_URL ?? original.origin;
        const verifyUrl = new URL('/login/verify', base);
        verifyUrl.search = original.search;
        // Fire and forget: the SMTP round trip (hundreds of ms) must not sit
        // in the response path, or /login answers measurably slower for
        // known accounts than for unknown ones (timing oracle on account
        // existence). The process is persistent (no serverless teardown) and
        // the send needs no request context; failures are logged without
        // address or token, and the user-facing message is neutral anyway.
        void sendMagicLinkEmail(identifier, verifyUrl.toString()).catch((err) => {
          console.error(
            `[auth] magic link send failed: ${err instanceof Error ? err.name : 'error'}`
          );
        });
      },
    }),
  ],
  callbacks: {
    // Defense in depth against implicit signup: runs both when sending the
    // link and when consuming it. At the REQUEST step the answer must not
    // depend on the account (pentest F2: a denial here redirected unknown
    // addresses to /login?error=AccessDenied, a working existence oracle on
    // the native endpoint); the gate is in sendVerificationRequest, which
    // sends nothing for an unknown address. At CONSUMPTION the check stands:
    // unknown or disabled email => denied, so @auth/core never reaches its
    // createUser branch.
    async signIn({ user, email }) {
      if (email?.verificationRequest) return true;
      if (!user?.email) return false;
      const { rows } = await getDb().query(
        'select 1 from users where email = $1 and disabled_at is null',
        [user.email]
      );
      return rows.length > 0;
    },
  },
});
