/**
 * Fluid sparkline. Null values break the line into segments (real gaps, not
 * shortcuts): the reference mock's Sparkline ignored nulls, this port fixes
 * it. Dots (last point, isolated points) are HTML overlays positioned in %:
 * inside the stretched SVG (preserveAspectRatio none) a circle would deform.
 * Purely decorative (aria-hidden); the value next to it carries the meaning.
 */
export function Sparkline({
  values,
  color = 'var(--text-3)',
  height = 32,
  fill = true,
  dot = true,
}: {
  values: Array<number | null>;
  color?: string;
  height?: number;
  fill?: boolean;
  dot?: boolean;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0 || values.length < 2) return <div style={{ height }} />;

  let min = Math.min(...present);
  let max = Math.max(...present);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;

  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 100 - ((v - min) / (max - min)) * 100;

  // Contiguous non-null runs; runs of one become dots.
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push([x(i), y(v)]);
    }
  });
  if (current.length > 0) segments.push(current);

  const dots: Array<[number, number]> = segments.filter((s) => s.length === 1).map((s) => s[0]);
  const last = segments[segments.length - 1];
  if (dot && last && last.length > 1) dots.push(last[last.length - 1]);

  return (
    <div style={{ position: 'relative', height }} aria-hidden>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {segments
          .filter((seg) => seg.length > 1)
          .map((seg, si) => {
            const pts = seg.map(([px, py]) => `${px},${py}`).join(' ');
            const area = `${seg[0][0]},100 ${pts} ${seg[seg.length - 1][0]},100`;
            return (
              <g key={si}>
                {fill && <polygon points={area} fill={color} opacity={0.12} />}
                <polyline
                  points={pts}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
      </svg>
      {dots.map(([dx, dy], i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${dx}%`,
            top: `${dy}%`,
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: color,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  );
}
