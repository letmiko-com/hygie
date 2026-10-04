// Page frame shared by the health screens and the Administration section:
// sidebar + content column. Server component; the layouts decide who gets
// which sections and what the content column holds.
import type { ReactNode } from 'react';
import { signOut } from '@/auth';
import { Sidebar, type NavSection } from './Sidebar';

export function AppShell({
  sections,
  userName,
  userDetail,
  logoutLabel,
  profileLabel,
  children,
}: {
  sections: NavSection[];
  userName: string;
  userDetail: string;
  logoutLabel: string;
  profileLabel: string;
  children: ReactNode;
}) {
  async function logout() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div className="hy-shell" style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch' }}>
      <Sidebar
        sections={sections}
        userName={userName}
        userDetail={userDetail}
        logoutLabel={logoutLabel}
        profileLabel={profileLabel}
        onLogout={logout}
      />
      <main className="hy-main" style={{ flex: 1, minWidth: 0, padding: '18px 22px 36px', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>{children}</div>
      </main>
    </div>
  );
}
