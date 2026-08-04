'use client';
// Catalogue controls and table. Client only for the FILTER: with a hundred
// types the search has to answer while you type, and a round trip per keystroke
// would not. Everything rendered here was resolved and formatted on the server
// (labels, values, dates, counts): no Intl runs in the browser, so nothing can
// hydrate differently from what the server sent.
//
// Deliberate departure from the rest of the app, where state lives in the URL:
// a search box is a way of looking through a list, not a view worth sharing.
// The group filter is in the same state for the same reason. The window and
// everything else remain URL state on the detail screen.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Sparkline } from '@/components/charts/Sparkline';
import { EmptyState } from '@/components/data/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { ABSENT } from '@/lib/format';

export interface CatalogRow {
  hk: string;
  href: string;
  label: string;
  /** Lowercased haystack: label, identifier, unit, group. Built server-side. */
  haystack: string;
  icon: string;
  color: string;
  unit: string | null;
  lastValue: string | null;
  lastWhen: string | null;
  measures: string;
  coverage: string;
  spark: Array<number | null>;
  dormant: boolean;
  occurrences: boolean;
}

export interface CatalogGroupData {
  key: string;
  label: string;
  rows: CatalogRow[];
}

export interface CatalogLabels {
  search: string;
  searchPlaceholder: string;
  allGroups: string;
  colMetric: string;
  colLast: string;
  colWhen: string;
  colMeasures: string;
  colCoverage: string;
  colTrend: string;
  matched: string;
  noMatch: string;
  noMatchHint: string;
  dormantBadge: string;
  occurrencesBadge: string;
}

const HEAD: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid var(--border-strong)',
  whiteSpace: 'nowrap',
};

const CELL: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  font: '400 var(--text-sm)/1.3 var(--font-ui)',
  whiteSpace: 'nowrap',
};

function Row({ row, labels }: { row: CatalogRow; labels: CatalogLabels }) {
  return (
    <tr>
      <td style={{ ...CELL, whiteSpace: 'normal' }}>
        <Link
          href={row.href}
          className="hy-ghost"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '2px 4px',
            margin: '-2px -4px',
            borderRadius: 'var(--r-sm)',
            textDecoration: 'none',
            color: 'var(--text-1)',
          }}
        >
          <Icon name={row.icon} size={16} color={row.color} />
          <span style={{ font: '500 var(--text-sm)/1.3 var(--font-ui)' }}>{row.label}</span>
        </Link>
        {row.unit && (
          <span
            className="tnum"
            style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)', marginLeft: 6 }}
          >
            {row.unit}
          </span>
        )}
        {row.occurrences && (
          <span style={{ marginLeft: 6 }}>
            <Badge tone="neutral">{labels.occurrencesBadge}</Badge>
          </span>
        )}
        {row.dormant && (
          <span style={{ marginLeft: 6 }}>
            {/* Neutral, not warn: a type nobody records any more is a fact,
                not a problem, and colour encodes quality in this design system. */}
            <Badge tone="neutral">{labels.dormantBadge}</Badge>
          </span>
        )}
      </td>
      <td
        className="tnum"
        style={{
          ...CELL,
          textAlign: 'right',
          font: '500 var(--text-sm)/1.3 var(--font-data)',
          color: row.lastValue === null ? 'var(--text-3)' : 'var(--text-1)',
        }}
      >
        {row.lastValue ?? ABSENT}
      </td>
      <td className="tnum" style={{ ...CELL, font: '400 var(--text-xs)/1.3 var(--font-data)', color: 'var(--text-2)' }}>
        {row.lastWhen ?? ABSENT}
      </td>
      <td
        className="tnum"
        style={{ ...CELL, textAlign: 'right', font: '400 var(--text-sm)/1.3 var(--font-data)', color: 'var(--text-2)' }}
      >
        {row.measures}
      </td>
      <td className="tnum" style={{ ...CELL, font: '400 var(--text-xs)/1.3 var(--font-data)', color: 'var(--text-3)' }}>
        {row.coverage}
      </td>
      <td style={{ ...CELL, width: 132, minWidth: 132 }}>
        {/* Fewer than two measured days is not a shape. An empty cell reads as
            a broken chart, so the absence is written out. */}
        {row.spark.filter((v) => v !== null).length < 2 ? (
          <span
            className="tnum"
            style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}
          >
            {ABSENT}
          </span>
        ) : (
          <Sparkline values={row.spark} color={row.color} height={24} />
        )}
      </td>
      <td style={{ ...CELL, width: 28, textAlign: 'right' }}>
        <Link
          href={row.href}
          aria-label={row.label}
          className="hy-ghost"
          style={{
            display: 'inline-flex',
            padding: 3,
            margin: -3,
            borderRadius: 'var(--r-sm)',
            color: 'var(--text-3)',
          }}
        >
          <Icon name="chevron_right" size={16} />
        </Link>
      </td>
    </tr>
  );
}

function GroupPanel({
  group,
  labels,
}: {
  group: CatalogGroupData;
  labels: CatalogLabels;
}) {
  return (
    <Panel padding="12px 10px">
      <div style={{ padding: '0 4px' }}>
        <PanelLabel
          trailing={
            <span className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
              {group.rows.length}
            </span>
          }
        >
          {group.label}
        </PanelLabel>
      </div>
      <div className="hy-scrollx" style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="hy-label" style={HEAD}>
                {labels.colMetric}
              </th>
              <th className="hy-label" style={{ ...HEAD, textAlign: 'right' }}>
                {labels.colLast}
              </th>
              <th className="hy-label" style={HEAD}>
                {labels.colWhen}
              </th>
              <th className="hy-label" style={{ ...HEAD, textAlign: 'right' }}>
                {labels.colMeasures}
              </th>
              <th className="hy-label" style={HEAD}>
                {labels.colCoverage}
              </th>
              <th className="hy-label" style={HEAD}>
                {labels.colTrend}
              </th>
              <th style={HEAD} />
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <Row key={row.hk} row={row} labels={labels} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function MetricCatalog({
  groups,
  total,
  labels,
}: {
  groups: CatalogGroupData[];
  total: number;
  labels: CatalogLabels;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .filter((g) => group === null || g.key === group)
      .map((g) => ({
        ...g,
        rows: needle === '' ? g.rows : g.rows.filter((r) => r.haystack.includes(needle)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, query, group]);

  const shown = filtered.reduce((acc, g) => acc + g.rows.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel padding="10px 12px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '1 1 220px', minWidth: 180 }}>
            <span className="hy-label" style={{ flex: 'none' }}>
              {labels.search}
            </span>
            <span style={{ position: 'relative', flex: 1, display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 7, display: 'inline-flex', pointerEvents: 'none' }}>
                <Icon name="search" size={15} color="var(--text-3)" />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={labels.searchPlaceholder}
                style={{
                  flex: 1,
                  height: 'var(--control-h-md)',
                  padding: '0 8px 0 27px',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg)',
                  color: 'var(--text-1)',
                  font: '400 var(--text-sm)/1 var(--font-ui)',
                  minWidth: 0,
                }}
              />
            </span>
          </label>

          <div
            role="tablist"
            aria-label={labels.allGroups}
            style={{
              display: 'inline-flex',
              gap: 2,
              padding: 2,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              flexWrap: 'wrap',
            }}
          >
            {[{ key: null, label: labels.allGroups }, ...groups.map((g) => ({ key: g.key, label: g.label }))].map(
              (tab) => {
                const active = group === tab.key;
                return (
                  <button
                    key={tab.key ?? '*'}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setGroup(tab.key)}
                    style={{
                      height: 22,
                      padding: '0 9px',
                      borderRadius: 'calc(var(--r-md) - 2px)',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      background: active ? 'var(--surface)' : 'transparent',
                      boxShadow: active ? 'var(--shadow-1)' : 'none',
                      color: active ? 'var(--text-1)' : 'var(--text-2)',
                      font: `${active ? 600 : 400} var(--text-xs)/1 var(--font-ui)`,
                    }}
                  >
                    {tab.label}
                  </button>
                );
              }
            )}
          </div>

          <span
            className="tnum"
            aria-live="polite"
            style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}
          >
            {labels.matched.replace('{shown}', String(shown)).replace('{total}', String(total))}
          </span>
        </div>
      </Panel>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState icon="search_off" title={labels.noMatch} hint={labels.noMatchHint} />
        </Panel>
      ) : (
        filtered.map((g) => <GroupPanel key={g.key} group={g} labels={labels} />)
      )}
    </div>
  );
}
