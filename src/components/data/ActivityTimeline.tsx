// Reusable activity timeline: one antichronological rail, days as headings
// with relative labels, entries as rows on the rail. Presentational only —
// it receives already-formatted groups, so any screen can feed it (the
// dashboard does today, a future "journal" screen could tomorrow).
//
// Semantics: an ordered list of days, each holding an ordered list of
// entries. An entry that has a detail screen is a link, the others are inert
// rows; nothing is a clickable div. Null stats render the absence glyph, and
// a day with nothing in it never reaches this component at all.
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { ABSENT } from '@/lib/format';

export interface TimelineStat {
  label: string;
  value: string | null;
  color?: string;
}

export interface TimelineItem {
  key: string;
  /** Omitted when no detail screen exists: the row renders inert. */
  href?: string;
  icon: string;
  color: string;
  title: string;
  /** Pre-joined secondary line ("22:31 → 05:17 · 6 h 46"). */
  meta: string;
  stats: TimelineStat[];
  badge?: { label: string; tone: BadgeTone };
  /** Small right-aligned attribution, when the source matters. */
  note?: string | null;
}

export interface TimelineGroup {
  day: string;
  /** "Today", "Yesterday", or a formatted date. */
  label: string;
  /** Secondary label, e.g. the weekday for a dated group. */
  sub?: string;
  items: TimelineItem[];
}

function Row({ item }: { item: TimelineItem }) {
  const content = (
    <>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: -21,
          top: 14,
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: item.color,
          border: '2px solid var(--surface)',
          boxSizing: 'content-box',
        }}
      />
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 'var(--r-md)',
          background: `color-mix(in oklab, ${item.color} 13%, transparent)`,
          flex: 'none',
        }}
      >
        <Icon name={item.icon} size={16} color={item.color} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              font: '500 var(--text-base)/1.2 var(--font-ui)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </span>
          {item.badge && (
            <Badge tone={item.badge.tone}>{item.badge.label}</Badge>
          )}
        </span>
        <span
          className="tnum"
          style={{
            font: '400 var(--text-xs)/1.3 var(--font-data)',
            color: 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.meta}
        </span>
      </span>
      {item.stats.map((s, i) => (
        <span
          key={i}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}
        >
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
      {item.href && <Icon name="chevron_right" size={16} color="var(--text-3)" />}
    </>
  );

  const style = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px',
    borderRadius: 'var(--r-md)',
    textDecoration: 'none',
    color: 'inherit',
    minWidth: 0,
  } as const;

  return (
    <li style={{ position: 'relative', listStyle: 'none' }}>
      {item.href ? (
        <Link href={item.href} className="hy-row" style={style}>
          {content}
        </Link>
      ) : (
        <div style={style}>{content}</div>
      )}
    </li>
  );
}

export function ActivityTimeline({ groups }: { groups: TimelineGroup[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {groups.map((group) => (
        <li key={group.day}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 8px 4px' }}>
            <h3 className="hy-label" style={{ margin: 0 }}>
              {group.label}
            </h3>
            {group.sub && (
              <span className="tnum" style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
                {group.sub}
              </span>
            )}
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              marginLeft: 21,
              borderLeft: '1px solid var(--border)',
              paddingLeft: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {group.items.map((item) => (
              <Row key={item.key} item={item} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
