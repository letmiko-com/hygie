// POST-confirmation page: this is where the emailed link lands. Rendering it
// (GET) consumes NOTHING: mailbox link scanners that prefetch the URL cannot
// open a session. The token is only consumed when the user submits the form,
// a POST to /api/auth/callback/nodemailer with token/email/callbackUrl in the
// query string (where @auth/core reads them; CSRF only applies to credentials
// providers). On an invalid or expired token, Auth.js redirects to /login
// with ?error=Verification.
import Link from 'next/link';
import type { Metadata } from 'next';
import { IconBadge, LoginShell, PanelHeading, panelStyle, primaryButtonStyle } from '../ui';

export const metadata: Metadata = {
  title: 'Confirmer la connexion — Hygie',
  robots: { index: false, follow: false },
  // The URL carries the verification token: never leak it via the Referer header.
  referrer: 'no-referrer',
};

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = first(sp.token);
  const email = first(sp.email);

  if (!token || !email) {
    return (
      <LoginShell>
        <div style={{ ...panelStyle, alignItems: 'center', textAlign: 'center' }}>
          <IconBadge name="link_off" tone="danger" />
          <PanelHeading title="Lien incomplet">
            Ce lien de connexion est incomplet. Ouvrez le lien du dernier email reçu, ou
            demandez-en un nouveau.
          </PanelHeading>
          <Link href="/login" style={{ font: '400 var(--text-sm)/1 var(--font-ui)' }}>
            Retour à la connexion
          </Link>
        </div>
      </LoginShell>
    );
  }

  // callbackUrl is forced to '/' (relative): the link's absolute one is
  // ignored, so the post-login redirect can never point off-origin.
  const query = new URLSearchParams({ callbackUrl: '/', token, email });

  return (
    <LoginShell>
      <div style={{ ...panelStyle, alignItems: 'center', textAlign: 'center' }}>
        <IconBadge name="key" tone="accent" />
        <PanelHeading title="Confirmer la connexion">
          Confirmez pour ouvrir votre session sur cet appareil. Si vous n&apos;êtes pas à
          l&apos;origine de cette demande, fermez cette page.
        </PanelHeading>
        <form method="post" action={`/api/auth/callback/nodemailer?${query.toString()}`} style={{ width: '100%' }}>
          <button
            type="submit"
            className="hy-btn"
            style={{ ...primaryButtonStyle, width: '100%' }}
          >
            <span className="msym" aria-hidden style={{ fontSize: 16 }}>
              check_circle
            </span>
            Confirmer la connexion
          </button>
        </form>
      </div>
    </LoginShell>
  );
}
