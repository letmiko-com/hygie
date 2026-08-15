// Overlay chart for the explorer: N series, one shared time axis.
//
// SCALE DECISION (the readability question this screen lives or dies on):
//   - every series shares one unit  -> ONE absolute axis, real values, any
//     number of series. Three heart-rate metrics in bpm belong together.
//   - exactly two series, two units -> TWO absolute axes, left and right,
//     each labelled with its unit. Nothing is distorted, both are exact.
//   - anything else (three or more series with mixed units) -> NORMALIZED:
//     each series is scaled to its own min-max over the visible window and
//     plotted on a 0-100 % axis. Shapes stay comparable, values do not, so
//     the real range of every series is printed in the legend and the chart
//     says so in words. Six y-axes would be unreadable and three would be a
//     lie of precision.
// The caller can force normalization; it can never force more than two axes.
//
// Gaps are gaps: a null breaks the line, it is never bridged and never 0.
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { DrillZone } from '@/lib/drill';

export interface OverlaySeries {
  key: string;
  label: string;
  color: string;
  /** Display unit, already converted by the caller. */
  unit: string | null;
  values: Array<number | null>;
  /** Rolling mean window: draws the raw line faint and the mean bold. */
  rolling?: number;
}

export type ScaleMode = 'absolute' | 'normalized';

export interface ScalePlan {
  mode: ScaleMode;
  /** Axis index per series key, 0 = left, 1 = right (absolute mode only). */
  axisOf: Map<string, 0 | 1>;
  /** Unit rendered on each axis (absolute mode only). */
  axisUnits: [string | null, string | null];
}

/** Decides the scale from the series alone, unless normalization is forced. */
export function planScale(series: OverlaySeries[], force: ScaleMode | null): ScalePlan {
  const axisOf = new Map<string, 0 | 1>();
  const units = [...new Set(series.map((s) => s.unit ?? ''))];

  if (force !== 'normalized' && series.length > 0) {
    if (units.length === 1) {
      for (const s of series) axisOf.set(s.key, 0);
      return { mode: 'absolute', axisOf, axisUnits: [series[0].unit, null] };
    }
    if (series.length === 2) {
      axisOf.set(series[0].key, 0);
      axisOf.set(series[1].key, 1);
      return { mode: 'absolute', axisOf, axisUnits: [series[0].unit, series[1].unit] };
    }
  }
  for (const s of series) axisOf.set(s.key, 0);
  return { mode: 'normalized', axisOf, axisUnits: [null, null] };
}

function rollingMean(data: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return data;
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

function bounds(values: Array<number | null>): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  if (min === null || max === null) return null;
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  // A count never goes below zero: padding a step count into negative
  // territory would print an axis label that cannot exist.
  return { min: min >= 0 ? Math.max(0, min - pad) : min - pad, max: max + pad };
}

function polyline(
  data: Array<number | null>,
  x: (i: number) => number,
  y: (v: number) => number
): Array<Array<[number, number]>> {
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

function AxisColumn({
  ticks,
  format,
  unit,
  height,
  align,
}: {
  ticks: number[];
  format: (v: number) => string;
  unit: string | null;
  height: number;
  align: 'left' | 'right';
}) {
  return (
    <div
      className="tnum"
      style={{
        width: 46,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        textAlign: align === 'left' ? 'right' : 'left',
        font: '400 10px/1 var(--font-data)',
        color: 'var(--chart-axis)',
        height,
      }}
    >
      {ticks.map((t, i) => (
        <span key={i} title={unit ?? undefined}>
          {format(t)}
        </span>
      ))}
    </div>
  );
}

export function MultiLineChart({
  series,
  plan,
  xLabels,
  height = 300,
  gridLines = 4,
  makeFormat,
  ariaLabel,
  emptyLabel,
  drill,
}: {
  series: OverlaySeries[];
  plan: ScalePlan;
  xLabels: string[];
  height?: number;
  gridLines?: number;
  /**
   * Builds a formatter from the magnitude of ONE axis: a left axis in
   * thousands of steps and a right axis in hours of sleep do not deserve the
   * same number of decimals, and a shared formatter would round one of them
   * into uselessness.
   */
  makeFormat: (maxAbs: number) => (v: number) => string;
  ariaLabel: string;
  emptyLabel: string;
  /**
   * One clickable zone per bucket (same indexing as the values): a
   * full-height band opening that bucket's day span. Null entries stay inert.
   */
  drill?: Array<DrillZone | null>;
}) {
  const prepared = series.map((s) => ({
    ...s,
    smoothed: s.rolling && s.rolling > 1 ? rollingMean(s.values, s.rolling) : null,
  }));
  const hasAny = prepared.some((s) => s.values.some((v) => v !== null));
  if (!hasAny) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: 'italic 400 var(--text-sm)/1.4 var(--font-ui)',
          color: 'var(--text-3)',
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  const n = Math.max(...prepared.map((s) => s.values.length), 1);
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);

  // One scale per axis in absolute mode (built from every series it carries),
  // one scale per series in normalized mode.
  const axisBounds: Array<{ min: number; max: number } | null> = [null, null];
  if (plan.mode === 'absolute') {
    for (const axis of [0, 1] as const) {
      const members = prepared.filter((s) => plan.axisOf.get(s.key) === axis);
      if (members.length === 0) continue;
      const all = members.flatMap((s) => [...s.values, ...(s.smoothed ?? [])]);
      axisBounds[axis] = bounds(all);
    }
  }

  const scaleFor = (key: string): ((v: number) => number) => {
    if (plan.mode === 'normalized') {
      const s = prepared.find((p) => p.key === key);
      const b = s ? bounds([...s.values, ...(s.smoothed ?? [])]) : null;
      if (!b) return () => 50;
      return (v) => 100 - ((v - b.min) / (b.max - b.min)) * 100;
    }
    const axis = plan.axisOf.get(key) ?? 0;
    const b = axisBounds[axis];
    if (!b) return () => 50;
    return (v) => 100 - ((v - b.min) / (b.max - b.min)) * 100;
  };

  const ticksOf = (b: { min: number; max: number } | null): number[] =>
    b === null
      ? []
      : Array.from({ length: gridLines + 1 }, (_, i) => b.max - ((b.max - b.min) * i) / gridLines);

  const leftTicks =
    plan.mode === 'normalized'
      ? Array.from({ length: gridLines + 1 }, (_, i) => 100 - (100 * i) / gridLines)
      : ticksOf(axisBounds[0]);
  const rightTicks = plan.mode === 'absolute' ? ticksOf(axisBounds[1]) : [];
  const magnitudeOf = (ticks: number[]): number => Math.max(1, ...ticks.map(Math.abs));
  const formatLeft = makeFormat(magnitudeOf(leftTicks));
  const formatRight = makeFormat(magnitudeOf(rightTicks));

  const legend: ReactNode = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10 }}>
      {prepared.map((s) => {
        const axis = plan.axisOf.get(s.key) ?? 0;
        return (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span aria-hidden style={{ width: 12, height: 2, background: s.color, flex: 'none' }} />
            <span style={{ font: '500 var(--text-xs)/1.2 var(--font-ui)', color: 'var(--text-1)' }}>
              {s.label}
            </span>
            {s.unit && (
              <span className="tnum" style={{ font: '400 var(--text-2xs)/1.2 var(--font-data)', color: 'var(--text-3)' }}>
                {s.unit}
                {plan.mode === 'absolute' && plan.axisUnits[1] !== null && (axis === 0 ? ' ←' : ' →')}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );

  return (
    <div>
      {/* With drill bands inside, role="img" would flatten the links out of
          the accessibility tree: the group role keeps them reachable. */}
      <div role={drill ? 'group' : 'img'} aria-label={ariaLabel} style={{ display: 'flex', gap: 8 }}>
        <AxisColumn
          ticks={leftTicks}
          format={plan.mode === 'normalized' ? (v) => `${Math.round(v)}%` : formatLeft}
          unit={plan.axisUnits[0]}
          height={height}
          align="left"
        />
        <div style={{ position: 'relative', flex: 1, minWidth: 0, height }}>
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
            {leftTicks.map((_, i) => (
              <div key={i} style={{ borderTop: '1px solid var(--chart-grid)' }} />
            ))}
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {prepared.map((s) => {
              const y = scaleFor(s.key);
              const raw = polyline(s.values, x, y);
              const smooth = s.smoothed ? polyline(s.smoothed, x, y) : null;
              return (
                <g key={s.key}>
                  {raw.map((seg, si) =>
                    seg.length < 2 ? null : (
                      <polyline
                        key={`r${si}`}
                        points={seg.map(([px, py]) => `${px},${py}`).join(' ')}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={smooth ? 1 : 1.5}
                        opacity={smooth ? 0.28 : 1}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                      />
                    )
                  )}
                  {smooth?.map((seg, si) =>
                    seg.length < 2 ? null : (
                      <polyline
                        key={`s${si}`}
                        points={seg.map(([px, py]) => `${px},${py}`).join(' ')}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                      />
                    )
                  )}
                </g>
              );
            })}
          </svg>
          {/* Isolated measures (a bucket surrounded by gaps) carry no line to
              be drawn on. They are real data and must be visible, so they get
              a dot — positioned in HTML because the SVG above is stretched
              with preserveAspectRatio none and would squash a circle. */}
          {prepared.flatMap((s) => {
            const y = scaleFor(s.key);
            return polyline(s.values, x, y)
              .filter((seg) => seg.length === 1)
              .map(([[px, py]], i) => (
                <span
                  key={`${s.key}-dot-${i}`}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `${px}%`,
                    top: `${py}%`,
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: s.color,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ));
          })}
          {/* Drill bands: one full-height link per bucket, spanning to the
              midpoints with its neighbours. The wrapper clips the half-slot
              overhang of the edge bands. */}
          {drill && (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {drill.slice(0, n).map((zone, i) =>
                zone === null ? null : (
                  <Link
                    key={i}
                    href={zone.href}
                    className="hy-drill"
                    aria-label={zone.label}
                    title={zone.label}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: n <= 1 ? '0%' : `${((i - 0.5) / (n - 1)) * 100}%`,
                      width: n <= 1 ? '100%' : `${100 / (n - 1)}%`,
                    }}
                  />
                )
              )}
            </div>
          )}
        </div>
        {rightTicks.length > 0 && (
          <AxisColumn ticks={rightTicks} format={formatRight} unit={plan.axisUnits[1]} height={height} align="right" />
        )}
      </div>
      <div
        className="tnum"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginLeft: 54,
          marginRight: rightTicks.length > 0 ? 54 : 0,
          marginTop: 6,
          font: '400 var(--text-2xs)/1 var(--font-data)',
          color: 'var(--chart-axis)',
        }}
      >
        {xLabels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {legend}
    </div>
  );
}
