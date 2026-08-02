// Home: placeholder of the future dashboard. The proxy already gates this
// route, but the page re-checks with auth() (database lookup): a session
// revoked between two requests is dead here too.
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { Logo } from './login/ui';

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <Logo />
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 28,
          width: 400,
          maxWidth: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div style={{ font: '600 var(--text-lg)/1.3 var(--font-ui)' }}>Session ouverte</div>
          <div style={{ font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)', marginTop: 4 }}>
            Connecté en tant que <strong style={{ color: 'var(--text-1)' }}>{email}</strong>.
            Le tableau de bord arrivera ici.
          </div>
        </div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="hy-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 'var(--control-h-md)',
              padding: '0 14px',
              borderRadius: 'var(--r-md)',
              font: '500 var(--text-base)/1 var(--font-ui)',
              cursor: 'pointer',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              border: '1px solid var(--border-strong)',
              width: '100%',
            }}
          >
            <span className="msym" aria-hidden style={{ fontSize: 16 }}>
              logout
            </span>
            Se déconnecter
          </button>
        </form>
      </div>
      <span className="tnum" style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
        Hygie — self-hosted · AGPL-3.0
      </span>
    </main>
  );
}
