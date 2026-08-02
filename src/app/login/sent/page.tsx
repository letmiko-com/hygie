// Post-request confirmation (mock Login.jsx, step "sent"), deliberately
// neutral: same page and same words whether the account exists or not.
import Link from 'next/link';
import { IconBadge, LoginShell, PanelHeading, panelStyle } from '../ui';

export const metadata = { title: 'Lien envoyé — Hygie' };

export default function SentPage() {
  return (
    <LoginShell>
      <div style={{ ...panelStyle, alignItems: 'center', textAlign: 'center' }}>
        <IconBadge name="mark_email_unread" tone="accent" />
        <PanelHeading title="Lien envoyé">
          Si un compte correspond à cette adresse, un lien de connexion vient de lui être
          envoyé. Il est valable 15 minutes.
        </PanelHeading>
        <Link
          href="/login"
          style={{
            color: 'var(--text-3)',
            font: '400 var(--text-sm)/1 var(--font-ui)',
            padding: 6,
            borderRadius: 'var(--r-sm)',
          }}
        >
          Adresse erronée ? Réessayer
        </Link>
      </div>
    </LoginShell>
  );
}
