// Outgoing email over SMTP (nodemailer): the magic link, the invitation of a
// new member, the email change link and its notices, and the silence alert
// of the worker (src/lib/ingest/silence-alert.ts). Configuration is env-driven
// (.env.example: SMTP_HOST/PORT/USER/PASSWORD/FROM; port 2587 works from
// Railway). Test escape hatch: when HYGIE_MAIL_CAPTURE_DIR is set, the message
// goes through nodemailer's jsonTransport and is written to a file in that
// directory instead of being sent; nothing leaves the machine and nothing is
// logged (the link embeds the verification token: tokens never go to stdout).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import { getMessages } from '@/lib/i18n';

function buildTransport(): Transporter {
  if (process.env.HYGIE_MAIL_CAPTURE_DIR) {
    return createTransport({ jsonTransport: true });
  }
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST is not set');
  const port = Number(process.env.SMTP_PORT ?? 2587);
  const user = process.env.SMTP_USER;
  return createTransport({
    host,
    port,
    secure: port === 465, // otherwise STARTTLS
    requireTLS: port !== 465,
    auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined,
  });
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends one message to one recipient. Throws when the relay refuses it; the
 * error carries a count, never the address.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'Hygie <hygie@localhost>';
  const info = await buildTransport().sendMail({ from, ...message });

  const captureDir = process.env.HYGIE_MAIL_CAPTURE_DIR;
  if (captureDir && info.message) {
    await mkdir(captureDir, { recursive: true });
    const name = `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(join(captureDir, name), info.message, 'utf8');
  }

  const failed = [...(info.rejected ?? []), ...(info.pending ?? [])].filter(Boolean);
  if (failed.length > 0) {
    // Count only: no address in logs or errors.
    throw new Error(`email rejected for ${failed.length} recipient(s)`);
  }
}

/** Escapes text interpolated into an HTML email body. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sends the sign-in email. `verifyUrl` points to the harmless GET page /login/verify. */
export async function sendMagicLinkEmail(to: string, verifyUrl: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Connexion à Hygie',
    text: [
      'Bonjour,',
      '',
      'Pour vous connecter à Hygie, ouvrez ce lien puis confirmez la connexion :',
      verifyUrl,
      '',
      'Ce lien est valable 15 minutes et ne peut être utilisé qu\'une fois.',
      'Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message.',
    ].join('\n'),
    html: [
      '<p>Bonjour,</p>',
      '<p>Pour vous connecter à Hygie, ouvrez ce lien puis confirmez la connexion :</p>',
      `<p><a href="${verifyUrl}">Se connecter à Hygie</a></p>`,
      '<p>Ce lien est valable 15 minutes et ne peut être utilisé qu\'une fois.<br>',
      'Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message.</p>',
    ].join('\n'),
  });
}

/**
 * Sends the invitation of a new member (Administration section). It carries
 * no token: the invitee requests an ordinary magic link on the sign-in page,
 * whenever they get to it, instead of racing a 15-minute link.
 */
export async function sendInvitationEmail(invite: {
  to: string;
  name: string;
  inviter: string;
  locale: string;
  loginUrl: string;
}): Promise<void> {
  const m = getMessages(invite.locale).inviteMail;
  const lines = [m.greeting(invite.name), m.body(invite.inviter), m.signIn(invite.to)];
  await sendMail({
    to: invite.to,
    subject: m.subject(invite.inviter),
    text: [lines[0], '', lines[1], '', lines[2], invite.loginUrl, '', m.pair, '', m.ignore].join('\n'),
    html: [
      ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      `<p><a href="${escapeHtml(invite.loginUrl)}">${escapeHtml(m.signInLink)}</a></p>`,
      `<p>${escapeHtml(m.pair)}</p>`,
      `<p>${escapeHtml(m.ignore)}</p>`,
    ].join('\n'),
  });
}

/** The email change link, sent to the NEW address (src/lib/auth/email-change.ts). */
export async function sendEmailChangeLink(change: {
  to: string;
  from: string;
  name: string;
  locale: string;
  confirmUrl: string;
}): Promise<void> {
  const m = getMessages(change.locale).emailChangeMail;
  const lines = [m.greeting(change.name), m.body(change.from), m.action];
  await sendMail({
    to: change.to,
    subject: m.subject,
    text: [lines[0], '', lines[1], '', lines[2], change.confirmUrl, '', m.ignore].join('\n'),
    html: [
      ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      `<p><a href="${escapeHtml(change.confirmUrl)}">${escapeHtml(m.link)}</a></p>`,
      `<p>${escapeHtml(m.ignore)}</p>`,
    ].join('\n'),
  });
}

/** Tells the OLD address that a change was requested, or that it happened. */
export async function sendEmailChangeNotice(notice: {
  to: string;
  newEmail: string;
  locale: string;
  kind: 'requested' | 'changed';
}): Promise<void> {
  const m = getMessages(notice.locale).emailNoticeMail;
  const body = notice.kind === 'requested' ? m.requested(notice.newEmail) : m.changed(notice.newEmail);
  await sendMail({
    to: notice.to,
    subject: notice.kind === 'requested' ? m.requestedSubject : m.changedSubject,
    text: [body, '', m.notYou].join('\n'),
    html: [`<p>${escapeHtml(body)}</p>`, `<p>${escapeHtml(m.notYou)}</p>`].join('\n'),
  });
}
