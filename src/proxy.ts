// Session gate (Next proxy, Node runtime): everything except /login*, the
// Auth.js endpoints and /api/v1/ingest/* requires a valid database session.
// The check is REAL (auth_sessions lookup + user not disabled), not a mere
// cookie-presence test: revoking a session in the database takes effect on the
// next request. Constraint documented in next.config.ts: ingest routes stream
// bodies to disk and must NEVER be matched here.
import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, sessionCookieName } from '@/lib/auth/session';

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(sessionCookieName())?.value;
  let valid = false;
  if (raw) {
    try {
      valid = await isValidSession(raw);
    } catch (err) {
      // Fail closed, without leaking internals.
      console.error(`[proxy] session check failed: ${err instanceof Error ? err.message : 'error'}`);
      return new NextResponse('Service indisponible', { status: 503 });
    }
  }
  if (valid) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except: /login* (sign-in flow), /api/auth* (Auth.js endpoints,
  // needed to obtain a session), /api/v1/ingest* (device-key auth, streamed
  // bodies: keep out of any matcher, see next.config.ts), Next static assets.
  matcher: [
    '/((?!login|api/auth|api/v1/ingest|_next/static|_next/image|favicon\\.ico|robots\\.txt).*)',
  ],
};
