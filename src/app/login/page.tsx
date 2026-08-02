// Sign-in: email entry (mock Login.jsx, step "email"). Also the Auth.js error
// page (?error=Verification when a link is invalid or expired), rendered as a
// sober notice.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { requestLoginLink } from './actions';
import { LoginShell, PanelHeading, panelStyle, primaryButtonStyle } from './ui';

export const metadata = { title: 'Connexion — Hygie' };

const ERROR_MESSAGES: Record<string, string> = {
  Verification: 'Ce lien de connexion est invalide ou expiré. Demandez un nouveau lien.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');

  const sp = await searchParams;
  const errorCode = typeof sp.error === 'string' ? sp.error : undefined;
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? 'La connexion a échoué. Réessayez.')
    : undefined;

  return (
    <LoginShell>
      <div style={panelStyle}>
        <PanelHeading title="Connexion">
          Instance privée — l&apos;accès se fait uniquement sur invitation, par lien envoyé à
          votre adresse.
        </PanelHeading>
        {errorMessage && (
          <div
            style={{
              font: '400 var(--text-sm)/1.5 var(--font-ui)',
              color: 'var(--danger)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--r-md)',
              padding: '8px 10px',
            }}
          >
            {errorMessage}
          </div>
        )}
        <form action={requestLoginLink} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="hy-label">Adresse email</span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 'var(--control-h-md)',
                padding: '0 10px',
                background: 'var(--surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--r-md)',
              }}
            >
              <span className="msym" aria-hidden style={{ fontSize: 16, color: 'var(--text-3)' }}>
                mail
              </span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="vous@exemple.fr"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--text-1)',
                  font: '400 var(--text-base)/1 var(--font-ui)',
                }}
              />
            </span>
          </label>
          <button type="submit" className="hy-btn" style={primaryButtonStyle}>
            <span className="msym" aria-hidden style={{ fontSize: 16 }}>
              send
            </span>
            Recevoir le lien de connexion
          </button>
        </form>
      </div>
    </LoginShell>
  );
}
