'use server';
// Administration actions. Each one re-derives the instance context: a server
// action is a public endpoint, the layout that rendered the button proves
// nothing.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sendInvitationEmail, sendMemberDisabledEmail, sendMemberPurgedEmail } from '@/lib/auth/mailer';
import {
  correctInvitation,
  disableMember,
  enableMember,
  getInstanceContext,
  inviteMember,
  requestPurge,
  revokeMemberDevice,
  type MemberRecipient,
} from '@/lib/queries/instance';
import { reportError } from '@/lib/sentry';

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
    reportError(err, 'mail.invitation', { withholdMessage: true });
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
    reportError(err, 'mail.invitation', { withholdMessage: true });
  }
  return { ok: true, email, emailChanged: true, mailSent };
}

/**
 * Sends one notice per account; true when every one left. Awaited like the
 * invitation: this path is admin-only, its timing reveals nothing.
 */
async function notifyMembers(
  recipients: MemberRecipient[],
  send: (r: MemberRecipient) => Promise<void>,
  label: string
): Promise<boolean> {
  let allSent = true;
  for (const r of recipients) {
    try {
      await send(r);
    } catch (err) {
      allSent = false;
      console.error(`[admin] ${label} email failed: ${err instanceof Error ? err.name : 'error'}`);
      reportError(err, label, { withholdMessage: true });
    }
  }
  return allSent;
}

export async function disableMemberAction(formData: FormData): Promise<void> {
  const ictx = await getInstanceContext();
  if (!ictx) return;
  const subjectId = String(formData.get('subjectId') ?? '');
  if (!UUID.test(subjectId)) return;
  const outcome = await disableMember(ictx, subjectId);
  revalidatePath('/admin');
  revalidatePath(`/admin/members/${subjectId}`);
  if (!outcome.ok) return;
  const mailSent = await notifyMembers(
    outcome.recipients,
    (r) => sendMemberDisabledEmail({ to: r.email, name: r.name, admin: ictx.displayName, locale: r.locale }),
    'mail.member-disabled'
  );
  redirect(`/admin?notice=${mailSent ? 'disabled' : 'disabled-nomail'}`);
}

export async function enableMemberAction(formData: FormData): Promise<void> {
  const ictx = await getInstanceContext();
  if (!ictx) return;
  const subjectId = String(formData.get('subjectId') ?? '');
  if (!UUID.test(subjectId)) return;
  await enableMember(ictx, subjectId);
  revalidatePath('/admin');
  revalidatePath(`/admin/members/${subjectId}`);
}

export type PurgeResult =
  | { ok: true; mailSent: boolean }
  | { ok: false; error: 'invalid' | 'mismatch' | 'locked' | 'unauthorized' };

export async function purgeMemberAction(_prev: PurgeResult | null, formData: FormData): Promise<PurgeResult> {
  const ictx = await getInstanceContext();
  if (!ictx) return { ok: false, error: 'unauthorized' };
  const subjectId = String(formData.get('subjectId') ?? '');
  const typedName = String(formData.get('name') ?? '');
  if (!UUID.test(subjectId) || typedName.length > 80) return { ok: false, error: 'invalid' };

  const outcome = await requestPurge(ictx, subjectId, typedName);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidatePath('/admin');
  const mailSent = await notifyMembers(
    outcome.recipients,
    (r) => sendMemberPurgedEmail({ to: r.email, name: r.name, admin: ictx.displayName, locale: r.locale }),
    'mail.member-purged'
  );
  return { ok: true, mailSent };
}
