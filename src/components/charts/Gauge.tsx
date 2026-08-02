import { ABSENT } from '@/lib/format';

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const sx = cx + r * Math.cos(rad(startDeg));
  const sy = cy + r * Math.sin(rad(startDeg));
  const ex = cx + r * Math.cos(rad(endDeg));
  const ey = cy + r * Math.sin(rad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
}

const START = -130;
const SPAN = 260;

/**
 * Arc gauge. `max` is a comparison reference (e.g. the 90-day mean), never
 * a "goal": the fill ratio reads as "today vs usual". Null value renders
 * the track and the absence glyph.
 */
export function Gauge({
  value,
  max,
  display,
  unit,
  label,
  color = 'var(--accent)',
  size = 104,
}: {
  value: number | null;
  max: number;
  /** Preformatted value text (locale handled by the caller). */
  display: string;
  unit?: string;
  label: string;
  color?: string;
  size?: number;
}) {
  const c = size / 2;
  const r = c - 6;
  const ratio = value === null || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} aria-hidden style={{ position: 'absolute', inset: 0 }}>
        <path
          d={arcPath(c, c, r, START, START + SPAN)}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {ratio > 0 && (
          <path
            d={arcPath(c, c, r, START, START + SPAN * ratio)}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div className="tnum" style={{ font: `600 ${Math.round(size * 0.2)}px/1.1 var(--font-ui)` }}>
          {value === null ? ABSENT : display}
        </div>
        {unit && value !== null && (
          <div style={{ font: '400 var(--text-2xs)/1.2 var(--font-ui)', color: 'var(--text-3)' }}>{unit}</div>
        )}
        <div className="hy-label" style={{ marginTop: 2 }}>
          {label}
        </div>
      </div>
    </div>
  );
}
