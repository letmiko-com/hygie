// Auth.js v5, magic link only (docs/architecture.md §5).
// - Database sessions on our own tables via the explicit adapter: revocation is
//   a DELETE, immediately effective (no self-contained JWT).
// - No public signup: the signIn callback refuses any email that does not match
//   an active user, and the login action refuses to even send in that case.
// - The email carries a link to /login/verify (harmless GET); the token is only
//   consumed by the POST that page submits to /api/auth/callback/nodemailer
//   (@auth/core reads token/email from the query string; CSRF is only enforced
//   for credentials providers, verified against @auth/core 0.41 source).
import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { hygieAdapter } from '@/lib/auth/adapter';
import { sendMagicLinkEmail } from '@/lib/auth/mailer';
import { getDb } from '@/lib/db';
import { sessionCookieName, sessionCookieSecure } from '@/lib/auth/session';

export const MAGIC_LINK_MAX_AGE_S = 15 * 60; // « valable 15 minutes » (maquette Login)

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
      async sendVerificationRequest({ identifier, url }) {
        // `url` is the direct consuming callback; the email must NOT contain
        // it. Point to the confirmation page instead, same query string
        // (token, email, callbackUrl): mailbox link scanners GET that page
        // and consume nothing.
        const original = new URL(url);
        const base = process.env.HYGIE_BASE_URL ?? original.origin;
        const verifyUrl = new URL('/login/verify', base);
        verifyUrl.search = original.search;
        await sendMagicLinkEmail(identifier, verifyUrl.toString());
      },
    }),
  ],
  callbacks: {
    // Defense in depth against implicit signup: runs both when sending the
    // link and when consuming it. Unknown or disabled email => denied, so
    // @auth/core never reaches its createUser branch.
    async signIn({ user }) {
      if (!user?.email) return false;
      const { rows } = await getDb().query(
        'select 1 from users where email = $1 and disabled_at is null',
        [user.email]
      );
      return rows.length > 0;
    },
  },
});
