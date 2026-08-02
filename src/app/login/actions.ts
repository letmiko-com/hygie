'use server';
// Magic link request. Deliberately neutral: whatever the input (unknown email,
// disabled account, send failure), the user lands on /login/sent with the same
// message. No account-existence oracle in the response, no address and no
// token in the logs. For unknown emails, signIn is never even called: zero
// token created, zero email sent.
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { getDb } from '@/lib/db';

export async function requestLoginLink(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (email.length > 0 && email.length <= 254 && email.includes('@')) {
    try {
      const { rows } = await getDb().query(
        'select 1 from users where email = $1 and disabled_at is null',
        [email]
      );
      if (rows.length > 0) {
        await signIn('nodemailer', { email, redirect: false });
      }
    } catch (err) {
      // Neutral response either way; error name only (no address, no token).
      console.error(
        `[auth] magic link request failed: ${err instanceof Error ? err.name : 'error'}`
      );
    }
  }

  redirect('/login/sent');
}
