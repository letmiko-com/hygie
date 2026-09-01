import { ABSENT } from '@/lib/format';
import type { DrillSet } from '@/lib/drill';
import { DrillBands } from './DrillBands';

/**
 * Bar chart in pure flex divs (server-renderable, no chart dependency).
 * A null value renders a dashed floor marker with an explanatory tooltip:
 * a day with no data is visibly different from a day at zero.
 */
export function BarChart({
  data,
  labels = [],
  color = 'var(--accent)',
  height = 110,
  ariaLabel,
  noDataLabel,
  format = (v: number) => String(Math.round(v)),
  drill,
}: {
  data: Array<number | null>;
  /** Sparse axis labels rendered space-between under the bars. */
  labels?: string[];
  color?: string;
  height?: number;
  ariaLabel: string;
  noDataLabel: string;
  format?: (v: number) => string;
  /**
   * One clickable zone per bar (same indexing as data): the whole column
   * becomes the link, not just the bar, columns merged when too thin to hit
   * (DrillBands). Null entries stay inert.
   */
  drill?: DrillSet;
}) {
  const max = Math.max(1, ...data.filter((v): v is number => v !== null));
  // A fixed 6% gap only works for a handful of bars; 30 bars would eat the
  // whole width in gaps.
  const gap = data.length > 12 ? 2 : '6%';
  // The band's native tooltip carries the value the column would have shown.
  const titles = drill
    ? data.map((v, i) => {
        const zone = drill.zones[i];
        return zone ? `${v === null ? noDataLabel : format(v)} · ${zone.label}` : undefined;
      })
    : undefined;
  return (
    // With drill links inside, role="img" would flatten them out of the
    // accessibility tree: the group role keeps them reachable.
    <div role={drill ? 'group' : 'img'} aria-label={ariaLabel}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap,
          height,
          borderBottom: '1px solid var(--border-strong)',
          paddingBottom: 0,
        }}
      >
        {data.map((v, i) => {
          const linked = drill?.zones[i] != null;
          const bar =
            v === null ? (
              <span
                title={linked ? undefined : noDataLabel}
                style={{
                  display: 'block',
                  width: '100%',
                  height: 1,
                  borderTop: '2px dotted var(--text-3)',
                  background: 'transparent',
                }}
              />
            ) : (
              <span
                title={linked ? undefined : format(v)}
                style={{
                  display: 'block',
                  width: '100%',
                  height: `${Math.max(1.5, (v / max) * 100)}%`,
                  background: color,
                  borderRadius: '2px 2px 0 0',
                }}
              />
            );
          return (
            <span key={i} style={{ flex: 1, minWidth: 1, alignSelf: 'stretch', display: 'flex', alignItems: 'flex-end' }}>
              {bar}
            </span>
          );
        })}
        {drill && <DrillBands set={drill} n={data.length} align="slot" titles={titles} />}
      </div>
      {labels.length > 0 && (
        <div
          className="tnum"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            font: '400 var(--text-2xs)/1 var(--font-data)',
            color: 'var(--chart-axis)',
          }}
        >
          {labels.map((l, i) => (
            <span key={i}>{l || ABSENT}</span>
          ))}
        </div>
      )}
    </div>
  );
}
