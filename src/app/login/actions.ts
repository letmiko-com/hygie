'use server';
// Magic link request. Deliberately neutral: whatever the input (unknown email,
// disabled account, send failure), the user lands on /login/sent with the same
// message. No account-existence oracle in the response, no address and no
// token in the logs. For unknown emails, signIn is never even called: zero
// token created, zero email sent.
// Timing: the SMTP send is fire-and-forget (see auth.ts), and the response
// is padded to a constant floor so the remaining known-account work (token
// insert, ~10-20 ms) cannot be told apart from the unknown-account path.
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { getDb } from '@/lib/db';

const MIN_RESPONSE_MS = 400;

export async function requestLoginLink(formData: FormData): Promise<void> {
  const started = Date.now();
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

  const elapsed = Date.now() - started;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
  }
  redirect('/login/sent');
}
