import { Icon } from '@/components/ui/Icon';
import { fmtNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';

/**
 * Trend chip. Three decoupled visual channels (design system contract):
 * COLOR encodes quality (--ok improving, --danger degrading, neutral within
 * the +-0.5% dead zone) and is flipped by `invert` for metrics where going
 * down is good (resting HR...). The ICON encodes direction and is NEVER
 * inverted: a green downward arrow is a good decrease. The NUMBER carries
 * the amplitude, explicit sign, locale decimal. Null delta renders nothing:
 * a missing comparison window is not a flat trend.
 */
export function TrendChip({
  deltaPct,
  invert = false,
  label,
  locale,
}: {
  deltaPct: number | null;
  invert?: boolean;
  label?: string;
  locale: Locale;
}) {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return null;
  const up = deltaPct > 0;
  const flat = Math.abs(deltaPct) < 0.5;
  const good = flat ? null : invert ? !up : up;
  const color = flat ? 'var(--text-3)' : good ? 'var(--ok)' : 'var(--danger)';
  const icon = flat ? 'remove' : up ? 'arrow_drop_up' : 'arrow_drop_down';
  const amount = `${up ? '+' : ''}${fmtNumber(deltaPct, locale, 1)} %`;

  return (
    <span title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
      <Icon name={icon} size={16} color={color} />
      <span className="tnum" style={{ font: '500 var(--text-xs)/1 var(--font-data)', color }}>
        {amount}
      </span>
      {label && (
        <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 4 }}>
          {label}
        </span>
      )}
    </span>
  );
}
