import Link from 'next/link';
import { Sparkline } from '@/components/charts/Sparkline';
import { TrendChip } from '@/components/data/TrendChip';
import { Icon } from '@/components/ui/Icon';
import { ABSENT } from '@/lib/format';
import type { Locale } from '@/lib/i18n';

/**
 * Dashboard metric card: icon, label, value, trend chip and a full-width
 * sparkline. Empty state (no data at all on the period) shows the absence
 * glyph and an explicit caption, never a zero.
 *
 * With `href` the whole card becomes the link to that metric's own page: a
 * figure on a dashboard should always be openable to see what it is made of,
 * and the card is the target a reader aims at. Nothing inside it is
 * interactive, so nesting it in an anchor stays valid.
 */
export function MetricCard({
  icon,
  label,
  value,
  unit,
  deltaPct,
  invert = false,
  neutral = false,
  trendTitle,
  points,
  color,
  locale,
  emptyLabel,
  href,
}: {
  icon: string;
  label: string;
  /** Preformatted display value, null when the period has no data. */
  value: string | null;
  unit?: string;
  deltaPct: number | null;
  invert?: boolean;
  neutral?: boolean;
  trendTitle?: string;
  points: Array<number | null>;
  color: string;
  locale: Locale;
  emptyLabel: string;
  /** Detail page of this metric. Makes the whole card a link. */
  href?: string;
}) {
  const empty = value === null;
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name={icon} size={16} color={color} />
        <span className="hy-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {href && <Icon name="chevron_right" size={15} color="var(--text-3)" />}
      </div>
      {empty ? (
        <>
          <span style={{ font: '600 var(--text-2xl)/1.1 var(--font-ui)', color: 'var(--text-3)' }}>{ABSENT}</span>
          <span style={{ font: 'italic 400 var(--text-xs)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>
            {emptyLabel}
          </span>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span className="tnum" style={{ font: '600 var(--text-2xl)/1.1 var(--font-ui)' }}>
              {value}
              {unit && (
                <span style={{ font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 4 }}>
                  {unit}
                </span>
              )}
            </span>
            <TrendChip
              deltaPct={deltaPct}
              invert={invert}
              neutral={neutral}
              label={trendTitle}
              locale={locale}
            />
          </div>
          <Sparkline values={points} color={color} height={30} />
        </>
      )}
    </>
  );

  const style: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: '12px 14px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  };

  if (href) {
    return (
      <Link href={href} className="hy-row" style={{ ...style, textDecoration: 'none', color: 'var(--text-1)' }}>
        {body}
      </Link>
    );
  }
  return <div style={style}>{body}</div>;
}
