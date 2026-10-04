// Where the email change link lands. Like /login/verify, the GET changes
// nothing: the change is applied by the confirmation POST only. The token
// names the account, so the page speaks its language.
import type { Metadata } from 'next';
import Link from '@/components/ui/Link';
import { verifyEmailChangeToken } from '@/lib/auth/email-change';
import { getMessages } from '@/lib/i18n';
import { emailChangeAccount } from '@/lib/queries/profile';
import { IconBadge, LoginShell, PanelHeading, panelStyle } from '../ui';
import { ConfirmEmailChange } from './ui';

export const metadata: Metadata = {
  title: 'Adresse e-mail — Hygie',
  robots: { index: false, follow: false },
  // The URL carries the token: never leak it via the Referer header.
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function EmailChangePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';
  const claim = token ? verifyEmailChangeToken(token) : null;
  const account = claim ? await emailChangeAccount(claim) : null;
  const m = getMessages(account?.locale ?? 'fr').emailConfirm;

  return (
    <LoginShell>
      <div style={{ ...panelStyle, alignItems: 'center', textAlign: 'center' }}>
        {claim && account ? (
          <ConfirmEmailChange
            token={token}
            labels={{
              title: m.title,
              body: m.body(claim.from, claim.to),
              button: m.button,
              done: m.done,
              doneSignedIn: m.doneSignedIn,
              doneSignIn: m.doneSignIn,
              back: m.back,
              signIn: m.signIn,
              invalid: m.invalid,
              invalidBody: m.invalidBody,
              taken: m.taken,
            }}
          />
        ) : (
          <>
            <IconBadge name="link_off" tone="danger" />
            <PanelHeading title={m.invalid}>{m.invalidBody}</PanelHeading>
            <Link href="/login" style={{ font: '400 var(--text-sm)/1 var(--font-ui)' }}>
              {m.signIn}
            </Link>
          </>
        )}
      </div>
    </LoginShell>
  );
}
