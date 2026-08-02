import Link from 'next/link';

export interface LinkTab {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/** Tab row as links (server-rendered, URL is the state). */
export function LinkTabs({ tabs, ariaLabel }: { tabs: LinkTab[]; ariaLabel: string }) {
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? 'page' : undefined}
          className={t.active ? undefined : 'hy-ghost'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 10px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            color: t.active ? 'var(--text-1)' : 'var(--text-2)',
            font: `${t.active ? 600 : 400} var(--text-sm)/1 var(--font-ui)`,
            borderBottom: t.active ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
