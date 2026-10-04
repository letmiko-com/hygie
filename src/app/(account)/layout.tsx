// Shell of the account screens (the profile): any signed-in account, with or
// without a subject grant, admin or not. They read and write the account
// itself, never health data. Pages and actions re-derive the session user:
// a layout does not re-run on client-side navigation.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/shell/AppShell';
import { buildNav } from '@/components/shell/nav';
import { getMessages } from '@/lib/i18n';
import { getSessionUser, getSubjectContext } from '@/lib/queries/context';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  const [ctx, user] = await Promise.all([getSubjectContext(), getSessionUser()]);
  if (!user) redirect('/login');
  const m = getMessages(user.locale);

  return (
    <AppShell
      sections={buildNav(m, { hasSubject: ctx !== null, isAdmin: user.isAdmin })}
      userName={ctx?.subjectName ?? user.displayName}
      userDetail={user.email}
      logoutLabel={m.common.logout}
      profileLabel={m.common.profile}
    >
      {children}
    </AppShell>
  );
}
