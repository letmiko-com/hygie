// Magic link email over SMTP (nodemailer). Configuration is env-driven
// (.env.example: SMTP_HOST/PORT/USER/PASSWORD/FROM; port 2587 works from
// Railway). Test escape hatch: when HYGIE_MAIL_CAPTURE_DIR is set, the message
// goes through nodemailer's jsonTransport and is written to a file in that
// directory instead of being sent; nothing leaves the machine and nothing is
// logged (the link embeds the verification token: tokens never go to stdout).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';

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

/** Sends the sign-in email. `verifyUrl` points to the harmless GET page /login/verify. */
export async function sendMagicLinkEmail(to: string, verifyUrl: string): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'Hygie <hygie@localhost>';
  const transport = buildTransport();
  const info = await transport.sendMail({
    from,
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

  const captureDir = process.env.HYGIE_MAIL_CAPTURE_DIR;
  if (captureDir && info.message) {
    await mkdir(captureDir, { recursive: true });
    const name = `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(join(captureDir, name), info.message, 'utf8');
  }

  const failed = [...(info.rejected ?? []), ...(info.pending ?? [])].filter(Boolean);
  if (failed.length > 0) {
    // Count only: no address in logs or errors.
    throw new Error(`magic link email rejected for ${failed.length} recipient(s)`);
  }
}
