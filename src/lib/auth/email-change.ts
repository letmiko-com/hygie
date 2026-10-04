// Email change tokens (decision of 2026-10-04: a change only takes effect
// once the NEW address confirms it). Stateless on purpose, so no table and
// no migration: the token is an HMAC-signed payload naming the account, its
// address at request time and the requested address.
//
// Single use by construction: applying it requires the account's address to
// still be the one inside the token, so once the change is applied (or the
// address changed by any other means) every outstanding token for it is
// dead. It also dies after EMAIL_CHANGE_TTL_S.
//
// The key derives from AUTH_SECRET: rotating that secret voids pending
// changes, as it voids pending magic links.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const EMAIL_CHANGE_TTL_S = 60 * 60; // « valable une heure » (email text)

export interface EmailChangeClaim {
  userId: string;
  /** The account's address when the change was requested. */
  from: string;
  /** The requested address, the one that received the link. */
  to: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  // Domain separation: this key signs nothing else.
  return createHmac('sha256', secret).update('hygie:email-change:v1').digest();
}

function sign(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}

export function createEmailChangeToken(claim: Omit<EmailChangeClaim, 'exp'>, now = Date.now()): string {
  const full: EmailChangeClaim = { ...claim, exp: Math.floor(now / 1000) + EMAIL_CHANGE_TTL_S };
  const payload = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** The claim when the token is intact and unexpired, null otherwise. */
export function verifyEmailChangeToken(token: string, now = Date.now()): EmailChangeClaim | null {
  if (token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(payload), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as EmailChangeClaim;
    if (
      typeof claim.userId !== 'string' ||
      typeof claim.from !== 'string' ||
      typeof claim.to !== 'string' ||
      typeof claim.exp !== 'number'
    ) {
      return null;
    }
    return claim.exp > Math.floor(now / 1000) ? claim : null;
  } catch {
    return null;
  }
}
