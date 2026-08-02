/**
 * Year-style calendar heatmap: CSS grid, 7 rows, one column per week.
 * Three visually distinct cell states (structural for "no data != zero"):
 * null = no data at all (dashed outline), 0 = data present but nothing
 * counted (flat surface), > 0 = color ramp by intensity.
 */
export function CalendarHeatmap({
  values,
  titles,
  color = 'var(--data-activity)',
  dayLabels = [],
  ariaLabel,
}: {
  values: Array<number | null>;
  /** Tooltip per cell, same indexing as values. */
  titles?: string[];
  color?: string;
  /** 7 entries, blanks allowed (e.g. ['M','','W','','F','','']). */
  dayLabels?: string[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null && v > 0));
  return (
    <div role="img" aria-label={ariaLabel} style={{ display: 'flex', gap: 6 }}>
      {dayLabels.length > 0 && (
        <div
          className="tnum"
          style={{
            display: 'grid',
            gridTemplateRows: 'repeat(7, 11px)',
            gap: 3,
            font: '400 9px/11px var(--font-data)',
            color: 'var(--chart-axis)',
            textAlign: 'right',
          }}
        >
          {dayLabels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'repeat(7, 11px)',
          gridAutoFlow: 'column',
          gridAutoColumns: '11px',
          gap: 3,
        }}
      >
        {values.map((v, i) => {
          const title = titles?.[i];
          if (v === null) {
            return (
              <span
                key={i}
                title={title}
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 2,
                  boxSizing: 'border-box',
                  border: '1px dashed var(--border-strong)',
                  background: 'transparent',
                }}
              />
            );
          }
          const background =
            v === 0
              ? 'var(--surface-2)'
              : `color-mix(in oklab, ${color} ${Math.round(18 + (v / max) * 82)}%, transparent)`;
          return <span key={i} title={title} style={{ width: 11, height: 11, borderRadius: 2, background }} />;
        })}
      </div>
    </div>
  );
}
