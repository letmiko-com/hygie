'use server';
// Administration actions. Each one re-derives the instance context: a server
// action is a public endpoint, the layout that rendered the button proves
// nothing.
import { revalidatePath } from 'next/cache';
import { sendInvitationEmail } from '@/lib/auth/mailer';
import { correctInvitation, getInstanceContext, inviteMember, revokeMemberDevice } from '@/lib/queries/instance';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeMemberDeviceAction(formData: FormData): Promise<void> {
  const ictx = await getInstanceContext();
  if (!ictx) return;
  const subjectId = String(formData.get('subjectId') ?? '');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(subjectId) || !UUID.test(deviceId)) return;
  await revokeMemberDevice(ictx, subjectId, deviceId);
  revalidatePath('/admin');
  revalidatePath(`/admin/members/${subjectId}`);
}

export type InviteResult =
  | { ok: true; email: string; mailSent: boolean }
  | { ok: false; error: 'invalid' | 'exists' | 'unauthorized' };

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function inviteMemberAction(_prev: InviteResult | null, formData: FormData): Promise<InviteResult> {
  const ictx = await getInstanceContext();
  if (!ictx) return { ok: false, error: 'unauthorized' };

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const locale = formData.get('locale') === 'en' ? 'en' : 'fr';
  const timezone = String(formData.get('timezone') ?? '').trim();
  if (
    name.length === 0 ||
    name.length > 80 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    timezone.length > 64 ||
    !validTimezone(timezone)
  ) {
    return { ok: false, error: 'invalid' };
  }

  const outcome = await inviteMember(ictx, { name, email, locale, timezone });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidatePath('/admin');

  // The account exists whatever happens to the email: the invitee can still
  // request a link on the sign-in page. Awaited, unlike the login email: this
  // path is admin-only, so its timing reveals nothing to anyone.
  const base = (process.env.HYGIE_BASE_URL ?? '').replace(/\/$/, '');
  let mailSent = false;
  try {
    await sendInvitationEmail({ to: email, name, inviter: ictx.displayName, locale, loginUrl: `${base}/login` });
    mailSent = true;
  } catch (err) {
    console.error(`[admin] invitation email failed: ${err instanceof Error ? err.name : 'error'}`);
  }
  return { ok: true, email, mailSent };
}

export type CorrectionResult =
  | { ok: true; email: string; emailChanged: boolean; mailSent: boolean }
  | { ok: false; error: 'invalid' | 'exists' | 'locked' | 'unauthorized' };

export async function correctInvitationAction(
  _prev: CorrectionResult | null,
  formData: FormData
): Promise<CorrectionResult> {
  const ictx = await getInstanceContext();
  if (!ictx) return { ok: false, error: 'unauthorized' };

  const subjectId = String(formData.get('subjectId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (
    !UUID.test(subjectId) ||
    name.length === 0 ||
    name.length > 80 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { ok: false, error: 'invalid' };
  }

  const outcome = await correctInvitation(ictx, subjectId, { name, email });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidatePath('/admin');
  revalidatePath(`/admin/members/${subjectId}`);
  if (!outcome.emailChanged) return { ok: true, email, emailChanged: false, mailSent: false };

  const base = (process.env.HYGIE_BASE_URL ?? '').replace(/\/$/, '');
  let mailSent = false;
  try {
    await sendInvitationEmail({
      to: email,
      name,
      inviter: ictx.displayName,
      locale: outcome.locale,
      loginUrl: `${base}/login`,
    });
    mailSent = true;
  } catch (err) {
    console.error(`[admin] corrected invitation email failed: ${err instanceof Error ? err.name : 'error'}`);
  }
  return { ok: true, email, emailChanged: true, mailSent };
}
