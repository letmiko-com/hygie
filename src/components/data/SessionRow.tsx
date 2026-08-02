import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { SourceBadge } from '@/components/data/SourceBadge';
import { ABSENT } from '@/lib/format';

export interface SessionStat {
  label: string;
  value: string | null;
  color?: string;
}

/**
 * One workout line: sport chip, title + meta, right-aligned stats, source.
 * Null stats render the absence glyph ("not measured" is a fact).
 */
export function SessionRow({
  href,
  icon,
  color,
  title,
  meta,
  stats,
  sourceName,
}: {
  /** Omitted while the detail screen does not exist yet: renders inert. */
  href?: string;
  icon: string;
  color: string;
  title: string;
  /** Pre-joined "date · duration · distance" line. */
  meta: string;
  stats: SessionStat[];
  sourceName: string;
}) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    borderRadius: 'var(--r-md)',
    textDecoration: 'none',
    color: 'inherit',
    minWidth: 0,
  } as const;
  const content = (
    <>
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 'var(--r-md)',
          background: `color-mix(in oklab, ${color} 13%, transparent)`,
          flex: 'none',
        }}
      >
        <Icon name={icon} size={18} color={color} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: '500 var(--text-base)/1.2 var(--font-ui)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span className="tnum" style={{ font: '400 var(--text-xs)/1.2 var(--font-data)', color: 'var(--text-3)' }}>
          {meta}
        </span>
      </span>
      {stats.map((s, i) => (
        <span key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}>
          <span
            className="tnum"
            style={{
              font: '500 var(--text-sm)/1.1 var(--font-data)',
              color: s.value === null ? 'var(--text-3)' : (s.color ?? 'var(--text-1)'),
            }}
          >
            {s.value ?? ABSENT}
          </span>
          <span className="hy-label" style={{ fontSize: 9 }}>
            {s.label}
          </span>
        </span>
      ))}
      <SourceBadge name={sourceName} />
      {href && <Icon name="chevron_right" size={16} color="var(--text-3)" />}
    </>
  );

  if (!href) return <div style={rowStyle}>{content}</div>;
  return (
    <Link href={href} className="hy-row" style={rowStyle}>
      {content}
    </Link>
  );
}
