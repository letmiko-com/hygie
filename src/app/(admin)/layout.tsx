// Shell of the Administration section: admins only, with or without a
// subject grant. What these screens read comes from the instance layer
// (lib/queries/instance.ts), never from the health read layer. A non-admin
// gets a plain 404: the section does not announce itself. Every page and
// action re-checks the instance context, since a layout does not re-run on
// client-side navigation between its pages.
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/shell/AppShell';
import { buildNav } from '@/components/shell/nav';
import { getMessages } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { getInstanceContext } from '@/lib/queries/instance';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect('/login');

  const [ictx, ctx] = await Promise.all([getInstanceContext(), getSubjectContext()]);
  if (!ictx) notFound();
  const m = getMessages(ictx.locale);

  return (
    <AppShell
      sections={buildNav(m, { hasSubject: ctx !== null, isAdmin: true })}
      userName={ctx?.subjectName ?? email}
      userDetail={email}
      logoutLabel={m.common.logout}
    >
      {children}
    </AppShell>
  );
}
