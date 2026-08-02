import type { ReactNode } from 'react';

export interface LineSeries {
  data: Array<number | null>;
  color: string;
  label?: string;
  /** Rolling mean window: renders the raw line faint and the mean bold. */
  rolling?: number;
  dashed?: boolean;
  area?: boolean;
}

/**
 * Rolling mean that respects gaps: where the raw point is null the mean is
 * null too (otherwise the smoothed line would invent data across gaps and
 * beyond the last real day).
 */
export function rollingMean(data: Array<number | null>, window: number): Array<number | null> {
  return data.map((v0, i) => {
    if (v0 === null) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = data[j];
      if (v !== null) {
        sum += v;
        n += 1;
      }
    }
    return n === 0 ? null : sum / n;
  });
}

function segments(data: Array<number | null>, x: (i: number) => number, y: (v: number) => number) {
  const out: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  data.forEach((v, i) => {
    if (v === null) {
      if (run.length > 0) out.push(run);
      run = [];
    } else {
      run.push([x(i), y(v)]);
    }
  });
  if (run.length > 0) out.push(run);
  return out;
}

function Path({
  data,
  x,
  y,
  color,
  width,
  opacity = 1,
  dashed = false,
  area = false,
}: {
  data: Array<number | null>;
  x: (i: number) => number;
  y: (v: number) => number;
  color: string;
  width: number;
  opacity?: number;
  dashed?: boolean;
  area?: boolean;
}) {
  return (
    <>
      {segments(data, x, y).map((seg, si) => {
        if (seg.length === 1) return null;
        const pts = seg.map(([px, py]) => `${px},${py}`).join(' ');
        return (
          <g key={si}>
            {area && (
              <polygon
                points={`${seg[0][0]},100 ${pts} ${seg[seg.length - 1][0]},100`}
                fill={color}
                opacity={0.1}
              />
            )}
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={width}
              opacity={opacity}
              strokeDasharray={dashed ? '5 4' : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </>
  );
}

/**
 * Line chart, SVG stretched in a flex row next to an HTML y-axis column
 * (design reference: design/components/charts/LineChart.jsx). Null points
 * break the lines into real gaps. Comparison series use the same color
 * dashed, per the design charter.
 */
export function LineChart({
  series,
  xLabels = [],
  height = 190,
  yFormat = (v: number) => String(Math.round(v)),
  gridLines = 3,
  ariaLabel,
}: {
  series: LineSeries[];
  xLabels?: string[];
  height?: number;
  yFormat?: (v: number) => string;
  gridLines?: number;
  ariaLabel: string;
}) {
  const rolled = series.map((s) => ({
    ...s,
    rolledData: s.rolling ? rollingMean(s.data, s.rolling) : null,
  }));
  const all = rolled.flatMap((s) => [...s.data, ...(s.rolledData ?? [])]).filter(
    (v): v is number => v !== null
  );
  if (all.length === 0) return <div style={{ height }} />;

  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const n = Math.max(...rolled.map((s) => s.data.length));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - ((v - min) / (max - min)) * 100;

  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => max - ((max - min) * i) / gridLines);
  const legend: ReactNode[] = rolled
    .filter((s) => s.label)
    .map((s, i) => (
      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 2,
            background: s.dashed
              ? `repeating-linear-gradient(90deg, ${s.color} 0 3px, transparent 3px 5px)`
              : s.color,
          }}
        />
        <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-2)' }}>{s.label}</span>
      </span>
    ));

  return (
    <div role="img" aria-label={ariaLabel}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div
          className="tnum"
          style={{
            width: 34,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            textAlign: 'right',
            font: '400 10px/1 var(--font-data)',
            color: 'var(--chart-axis)',
            height,
          }}
        >
          {ticks.map((t, i) => (
            <span key={i}>{yFormat(t)}</span>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, height }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            {ticks.map((_, i) => (
              <div key={i} style={{ borderTop: `1px solid var(--chart-grid)` }} />
            ))}
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {rolled.map((s, i) =>
              s.rolledData ? (
                <g key={i}>
                  <Path data={s.data} x={x} y={y} color={s.color} width={1} opacity={0.3} />
                  <Path data={s.rolledData} x={x} y={y} color={s.color} width={2} dashed={s.dashed} area={s.area} />
                </g>
              ) : (
                <Path
                  key={i}
                  data={s.data}
                  x={x}
                  y={y}
                  color={s.color}
                  width={s.dashed ? 1.5 : 2}
                  opacity={s.dashed ? 0.7 : 1}
                  dashed={s.dashed}
                  area={s.area}
                />
              )
            )}
          </svg>
        </div>
      </div>
      {(xLabels.length > 0 || legend.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, marginLeft: 42 }}>
          <div
            className="tnum"
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'space-between',
              font: '400 var(--text-2xs)/1 var(--font-data)',
              color: 'var(--chart-axis)',
            }}
          >
            {xLabels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          {legend.length > 0 && <div style={{ display: 'flex', gap: 12, marginLeft: 12 }}>{legend}</div>}
        </div>
      )}
    </div>
  );
}
