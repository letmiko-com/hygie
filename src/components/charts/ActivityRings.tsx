// The three activity rings as concentric arcs. Each ring reads value over
// goal, capped at one turn (a 180 % day still shows a full ring, the number
// carries the excess). A ring without a goal or a value draws its track
// only: no data is not zero.
export interface Ring {
  value: number | null;
  goal: number | null;
  color: string;
  label: string;
}

function arc(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0, Math.min(0.9999, fraction));
  const end = -Math.PI / 2 + f * 2 * Math.PI;
  const sx = cx;
  const sy = cy - r;
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  const large = f > 0.5 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export function ActivityRings({
  rings,
  size = 120,
  stroke,
  ariaLabel,
}: {
  rings: [Ring, Ring, Ring];
  size?: number;
  stroke?: number;
  ariaLabel: string;
}) {
  const c = size / 2;
  const w = stroke ?? Math.max(4, Math.round(size / 10));
  const gap = Math.max(2, Math.round(w * 0.35));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
      {rings.map((ring, i) => {
        const r = c - w / 2 - i * (w + gap);
        const fraction = ring.value !== null && ring.goal !== null && ring.goal > 0 ? ring.value / ring.goal : 0;
        return (
          <g key={ring.label}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={ring.color} strokeWidth={w} opacity={0.16} />
            {fraction > 0 && (
              <path d={arc(c, c, r, fraction)} fill="none" stroke={ring.color} strokeWidth={w} strokeLinecap="round" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
