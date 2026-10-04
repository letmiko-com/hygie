'use server';
// Profile actions. The session user is re-derived on every call: a server
// action is a public endpoint, and an account only ever edits itself.
import { revalidatePath } from 'next/cache';
import { createEmailChangeToken } from '@/lib/auth/email-change';
import { sendEmailChangeLink, sendEmailChangeNotice } from '@/lib/auth/mailer';
import { getSessionUser } from '@/lib/queries/context';
import { emailTaken, isKnownTimezone, updateProfile } from '@/lib/queries/profile';

export type ProfileResult = { ok: true } | { ok: false; error: 'invalid' | 'unauthorized' };

function intlKnowsZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateProfileAction(_prev: ProfileResult | null, formData: FormData): Promise<ProfileResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthorized' };

  const name = String(formData.get('name') ?? '').trim();
  const locale = formData.get('locale') === 'en' ? 'en' : 'fr';
  const rawZone = formData.get('timezone');
  const timezone = rawZone === null ? null : String(rawZone).trim();
  if (name.length === 0 || name.length > 80) return { ok: false, error: 'invalid' };
  // Both must know the zone: Intl formats the times, Postgres cuts the days.
  if (timezone !== null && (timezone.length > 64 || !intlKnowsZone(timezone) || !(await isKnownTimezone(timezone)))) {
    return { ok: false, error: 'invalid' };
  }

  await updateProfile(user, { name, locale, timezone });
  // The name and the language show on every screen, through the shell.
  revalidatePath('/', 'layout');
  return { ok: true };
}

export type EmailChangeResult =
  | { ok: true; to: string }
  | { ok: false; error: 'invalid' | 'same' | 'taken' | 'cooldown' | 'mail' | 'unauthorized' };

/**
 * One request per account per minute: each one emails an address the member
 * types, so this keeps the instance from being used to flood a mailbox. In
 * memory, which is enough for the single Hygie process (architecture: one
 * instance); a restart only resets the wait.
 */
const COOLDOWN_MS = 60_000;
const lastRequest = new Map<string, number>();

export async function requestEmailChangeAction(
  _prev: EmailChangeResult | null,
  formData: FormData
): Promise<EmailChangeResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthorized' };

  const to = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: 'invalid' };
  if (to === user.email.toLowerCase()) return { ok: false, error: 'same' };
  const last = lastRequest.get(user.userId);
  if (last !== undefined && Date.now() - last < COOLDOWN_MS) return { ok: false, error: 'cooldown' };
  // Checked again when the change is applied: an address can be taken meanwhile.
  if (await emailTaken(to)) return { ok: false, error: 'taken' };
  lastRequest.set(user.userId, Date.now());

  const token = createEmailChangeToken({ userId: user.userId, from: user.email, to });
  const base = (process.env.HYGIE_BASE_URL ?? '').replace(/\/$/, '');
  try {
    await sendEmailChangeLink({
      to,
      from: user.email,
      name: user.displayName,
      locale: user.locale,
      confirmUrl: `${base}/login/email?token=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    console.error(`[profile] email change link failed: ${err instanceof Error ? err.name : 'error'}`);
    return { ok: false, error: 'mail' };
  }
  // The old address learns of the request; a failure here does not undo it.
  try {
    await sendEmailChangeNotice({ to: user.email, newEmail: to, locale: user.locale, kind: 'requested' });
  } catch (err) {
    console.error(`[profile] email change notice failed: ${err instanceof Error ? err.name : 'error'}`);
  }
  return { ok: true, to };
}
