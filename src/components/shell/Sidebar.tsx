'use client';
// Application sidebar (design reference: design/components/navigation/
// Sidebar.jsx). Client component only for the active-route state; all data
// (items, user, i18n labels) comes from the server layout as props, and the
// logout form posts the server action passed down.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

export interface NavItem {
  href: string;
  icon: string;
  label: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  sections,
  userName,
  userDetail,
  logoutLabel,
  onLogout,
}: {
  sections: NavSection[];
  userName: string;
  userDetail: string;
  logoutLabel: string;
  onLogout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <nav
      aria-label="Hygie"
      className="hy-sidebar"
      style={{
        width: 212,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        padding: '14px 10px 10px',
        boxSizing: 'border-box',
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      <div style={{ padding: '0 8px 14px' }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Logo size={22} />
        </Link>
      </div>

      <div className="hy-nav" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto' }}>
        {sections.map((section, si) => (
          <div key={si} className="hy-nav-section" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {section.label && (
              <span className="hy-label hy-nav-label" style={{ padding: '12px 8px 4px' }}>
                {section.label}
              </span>
            )}
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active ? undefined : 'hy-ghost'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    height: 30,
                    padding: '0 8px',
                    borderRadius: 'var(--r-md)',
                    textDecoration: 'none',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent-strong)' : 'var(--text-2)',
                    font: `${active ? 600 : 400} var(--text-base)/1 var(--font-ui)`,
                  }}
                >
                  <Icon name={item.icon} size={17} color={active ? 'var(--accent-strong)' : 'var(--text-3)'} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div
        className="hy-user"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 6px 2px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <span
          aria-hidden
          className="tnum"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--surface-3)',
            font: '600 var(--text-2xs)/1 var(--font-ui)',
            color: 'var(--text-2)',
            flex: 'none',
          }}
        >
          {initials}
        </span>
        <span
          className="hy-user-text"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span
            style={{
              font: '500 var(--text-sm)/1.1 var(--font-ui)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userName}
          </span>
          <span
            style={{
              font: '400 var(--text-2xs)/1.1 var(--font-ui)',
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userDetail}
          </span>
        </span>
        <form action={onLogout} style={{ display: 'flex' }}>
          <button
            type="submit"
            className="hy-btn hy-ghost"
            title={logoutLabel}
            aria-label={logoutLabel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 'var(--r-md)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-3)',
              padding: 0,
            }}
          >
            <Icon name="logout" size={16} />
          </button>
        </form>
      </div>
    </nav>
  );
}
