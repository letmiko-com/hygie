'use server';
// Applies an email change once the new address confirms it. Lives under
// /login because the link may be opened where no session exists (another
// device, another browser): the signed token is the authority, and the
// proxy lets /login/* through without a session.
import { cookies } from 'next/headers';
import { verifyEmailChangeToken } from '@/lib/auth/email-change';
import { sendEmailChangeNotice } from '@/lib/auth/mailer';
import { hashToken, sessionCookieName } from '@/lib/auth/session';
import { applyEmailChange, emailChangeAccount, sessionBelongsTo } from '@/lib/queries/profile';

export type ConfirmResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; error: 'invalid' | 'taken' };

export async function confirmEmailChangeAction(_prev: ConfirmResult | null, formData: FormData): Promise<ConfirmResult> {
  const claim = verifyEmailChangeToken(String(formData.get('token') ?? ''));
  if (!claim) return { ok: false, error: 'invalid' };
  const account = await emailChangeAccount(claim);
  if (!account) return { ok: false, error: 'invalid' };

  // Keep the confirming session only when it is the account's own.
  const raw = (await cookies()).get(sessionCookieName())?.value;
  const hash = raw ? hashToken(raw) : null;
  const keep = hash !== null && (await sessionBelongsTo(hash, claim.userId)) ? hash : null;

  const outcome = await applyEmailChange(claim, keep);
  if (outcome === 'stale') return { ok: false, error: 'invalid' };
  if (outcome === 'taken') return { ok: false, error: 'taken' };

  try {
    await sendEmailChangeNotice({ to: claim.from, newEmail: claim.to, locale: account.locale, kind: 'changed' });
  } catch (err) {
    console.error(`[profile] email changed notice failed: ${err instanceof Error ? err.name : 'error'}`);
  }
  return { ok: true, signedIn: keep !== null };
}
