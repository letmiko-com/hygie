// Tachogram of one heartbeat series: the delay between consecutive beats, in
// milliseconds, plotted against elapsed time. It is the raw material Apple's
// SDNN marker is computed from, and the shape a number cannot show — the
// respiratory sawtooth of a calm minute, the flat line of an effort.
//
// A gap (HealthKit reported missed beats) BREAKS the line: joining across it
// would draw a slow beat that never happened. The gap is marked on the axis
// instead, so a reader sees that the recording is interrupted rather than
// wondering about a hole.
// Wide enough for a four-digit interval plus its unit: at 44 the leading
// digit of "1294 ms" was painted outside the viewBox and simply vanished.
const PAD_L = 68;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 20;

export function Tachogram({
  intervalsMs,
  height = 200,
  color = 'var(--data-heart)',
  ariaLabel,
  yUnit,
  xUnit,
}: {
  intervalsMs: Array<number | null>;
  height?: number;
  color?: string;
  ariaLabel: string;
  /** Unit suffix of the y graduations, e.g. "ms". */
  yUnit: string;
  /** Unit suffix of the x graduations, e.g. "s". */
  xUnit: string;
}) {
  const width = 1000;
  // x is elapsed time, so a gap pushes the following beats to the right by the
  // delay it swallowed. Its own duration is unknown, so it counts for nothing
  // and the break in the line carries the information.
  const points: Array<{ t: number; v: number } | null> = [];
  let elapsed = 0;
  for (const raw of intervalsMs) {
    if (raw === null || !Number.isFinite(raw) || raw <= 0) {
      points.push(null);
      continue;
    }
    points.push({ t: elapsed / 1000, v: raw });
    elapsed += raw;
  }
  const values = points.filter((p): p is { t: number; v: number } => p !== null);
  if (values.length < 2) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: 'italic 400 var(--text-sm)/1.4 var(--font-ui)',
          color: 'var(--text-3)',
          background: 'var(--surface-2)',
          borderRadius: 'var(--r-sm)',
        }}
      >
        —
      </div>
    );
  }

  const maxT = Math.max(...values.map((p) => p.t)) || 1;
  const rawMin = Math.min(...values.map((p) => p.v));
  const rawMax = Math.max(...values.map((p) => p.v));
  // A flat series must not fill the frame with noise: keep at least 40 ms of
  // scale around the value, then pad by a tenth of the span.
  const span = Math.max(rawMax - rawMin, 40);
  const mid = (rawMax + rawMin) / 2;
  const yMin = mid - span / 2 - span * 0.1;
  const yMax = mid + span / 2 + span * 0.1;

  const x = (t: number) => PAD_L + (t / maxT) * (width - PAD_L - PAD_R);
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (height - PAD_T - PAD_B);

  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  for (const p of points) {
    if (p === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push([x(p.t), y(p.v)]);
  }
  if (run.length > 0) runs.push(run);

  const gapMarks: number[] = [];
  points.forEach((p, i) => {
    if (p !== null) return;
    // Anchor the mark on the last beat before the hole.
    for (let j = i - 1; j >= 0; j--) {
      const prev = points[j];
      if (prev) {
        gapMarks.push(x(prev.t));
        return;
      }
    }
  });

  const ticks = [yMin + (yMax - yMin) * 0.15, mid, yMax - (yMax - yMin) * 0.15];
  const dot = values.length <= 120;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="auto"
      style={{ display: 'block' }}
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text
            x={PAD_L - 6}
            y={y(t) + 3}
            textAnchor="end"
            style={{ font: '500 10px var(--font-data)', fill: 'var(--text-3)' }}
          >
            {`${Math.round(t)}${yUnit}`}
          </text>
        </g>
      ))}
      {gapMarks.map((gx, i) => (
        <line
          key={`gap-${i}`}
          x1={gx}
          x2={gx}
          y1={PAD_T}
          y2={height - PAD_B}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      {runs.map((r, i) => (
        <polyline
          key={i}
          points={r.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {dot &&
        values.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={2} fill={color} />
        ))}
      <text
        x={width - PAD_R}
        y={height - 6}
        textAnchor="end"
        style={{ font: '500 10px var(--font-data)', fill: 'var(--text-3)' }}
      >
        {`${Math.round(maxT)}${xUnit}`}
      </text>
      <text x={PAD_L} y={height - 6} style={{ font: '500 10px var(--font-data)', fill: 'var(--text-3)' }}>
        {`0${xUnit}`}
      </text>
    </svg>
  );
}
