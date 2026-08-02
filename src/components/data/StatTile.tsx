import type { ReactNode } from 'react';
import { ABSENT } from '@/lib/format';

/**
 * Compact label / value / sub tile. A null value renders the absence glyph
 * (no data != zero); `sub` typically hosts a TrendChip or a secondary fact.
 */
export function StatTile({
  label,
  value,
  unit,
  sub,
  color,
  align = 'left',
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  sub?: ReactNode;
  color?: string;
  align?: 'left' | 'right';
}) {
  const absent = value === null || value === '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span className="hy-label">{label}</span>
      <span
        className="tnum"
        style={{
          font: '600 var(--text-xl)/1.15 var(--font-ui)',
          color: absent ? 'var(--text-3)' : (color ?? 'var(--text-1)'),
        }}
      >
        {absent ? ABSENT : value}
        {!absent && unit && (
          <span style={{ font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 4 }}>
            {unit}
          </span>
        )}
      </span>
      {sub && (
        <span style={{ font: '400 var(--text-2xs)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{sub}</span>
      )}
    </div>
  );
}
