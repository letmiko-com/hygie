// Application shell: sidebar + content column. The layout re-checks the
// session with auth() (database lookup) like every server entry point; the
// proxy is only the first gate. An account without a subject grant (pure
// admin) gets the shell and an explanatory empty state, never health data.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { EmptyState } from '@/components/data/EmptyState';
import { Sidebar, type NavSection } from '@/components/shell/Sidebar';
import { getMessages } from '@/lib/i18n';
import { getSessionUser, getSubjectContext } from '@/lib/queries/context';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  const [ctx, user] = await Promise.all([getSubjectContext(), getSessionUser()]);
  // The language is a property of the ACCOUNT, not of its health scope: a
  // pure-admin account has no subject context and must still be served in
  // its own language.
  const m = getMessages(ctx?.locale ?? user?.locale);

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }  // Four sections, by what the reader is doing: looking at the whole (overview),
  // reading one subject in depth (analysis), building their own view of the
  // raw material (data), and running the instance.
  const sections: NavSection[] = [
    {
      label: m.nav.overview,
      items: [
        { href: '/', icon: 'monitoring', label: m.nav.dashboard },
        { href: '/week', icon: 'view_week', label: m.nav.week },
        { href: '/calendar', icon: 'calendar_month', label: m.nav.calendar },
      ],
    },
    {
      label: m.nav.analysis,
      items: [
        { href: '/sport', icon: 'exercise', label: m.nav.sport },
        { href: '/sleep', icon: 'bedtime', label: m.nav.sleep },
        { href: '/markers', icon: 'ecg', label: m.nav.markers },
        { href: '/hrv', icon: 'monitor_heart', label: m.nav.hrv },
        { href: '/ecg', icon: 'cardiology', label: m.nav.ecg },
        { href: '/hearing', icon: 'hearing', label: m.nav.hearing },
        { href: '/records', icon: 'trophy', label: m.nav.records },
      ],
    },
    {
      label: m.nav.data,
      items: [
        { href: '/explore', icon: 'query_stats', label: m.nav.explore },
        { href: '/metrics', icon: 'database', label: m.nav.allData },
      ],
    },
    {
      label: m.nav.instance,
      items: [
        { href: '/sync', icon: 'sync', label: m.nav.sync },
        { href: '/devices', icon: 'devices', label: m.nav.devices },
      ],
    },
  ];

  return (
    <div className="hy-shell" style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <Sidebar
        sections={sections}
        userName={ctx?.subjectName ?? email}
        userDetail={email}
        logoutLabel={m.common.logout}
        onLogout={logout}
      />
      <main className="hy-main" style={{ flex: 1, minWidth: 0, padding: '18px 22px 36px', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {ctx ? children : <EmptyState icon="lock" title={m.noSubject.title} hint={m.noSubject.hint} />}
        </div>
      </main>
    </div>
  );
}
