import type { ReactNode } from 'react';
import { ABSENT } from '@/lib/format';

export interface Column<Row> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: number;
  mono?: boolean;
  muted?: boolean;
  render?: (row: Row) => ReactNode;
}

/**
 * Dense data table. A null cell renders the absence glyph in --text-3:
 * the table itself enforces "no data != zero".
 */
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  dense = false,
}: {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  dense?: boolean;
}) {
  const cellPad = dense ? '6px 8px' : '9px 8px';
  // Cells never wrap, so a narrow panel cannot shrink the table: without a
  // scroll container the last columns are painted outside the panel and are
  // simply unreachable (the records trend column at 1175 px wide).
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className="hy-label"
                style={{
                  textAlign: c.align ?? 'left',
                  padding: cellPad,
                  borderBottom: '1px solid var(--border-strong)',
                  width: c.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => {
                const raw = c.render ? c.render(row) : (row[c.key] as ReactNode);
                const absent = raw === null || raw === undefined || raw === '';
                return (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align ?? 'left',
                      padding: cellPad,
                      borderBottom: '1px solid var(--border)',
                      font: `400 var(--text-sm)/1.3 ${c.mono ? 'var(--font-data)' : 'var(--font-ui)'}`,
                      color: absent ? 'var(--text-3)' : c.muted ? 'var(--text-2)' : 'var(--text-1)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {absent ? ABSENT : raw}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
