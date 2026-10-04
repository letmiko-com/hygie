// Shell of the health screens. The layout re-checks the session with auth()
// (database lookup) like every server entry point; the proxy is only the
// first gate. An account without a subject grant never reaches health data:
// an admin lands on the Administration section, anyone else gets an
// explanatory empty state.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyState } from '@/components/data/EmptyState';
import { AppShell } from '@/components/shell/AppShell';
import { buildNav } from '@/components/shell/nav';
import { getMessages } from '@/lib/i18n';
import { getSessionUser, getSubjectContext } from '@/lib/queries/context';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  const [ctx, user] = await Promise.all([getSubjectContext(), getSessionUser()]);
  if (!ctx && user?.isAdmin) redirect('/admin');
  // The language is a property of the ACCOUNT, not of its health scope: an
  // account without a subject context must still be served in its language.
  const m = getMessages(ctx?.locale ?? user?.locale);

  return (
    <AppShell
      sections={buildNav(m, { hasSubject: ctx !== null, isAdmin: user?.isAdmin ?? false })}
      userName={ctx?.subjectName ?? email}
      userDetail={email}
      logoutLabel={m.common.logout}
      profileLabel={m.common.profile}
    >
      {ctx ? children : <EmptyState icon="lock" title={m.noSubject.title} hint={m.noSubject.hint} />}
    </AppShell>
  );
}
