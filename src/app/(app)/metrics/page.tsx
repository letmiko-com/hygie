// Catalogue: every measure type the subject actually has, grouped by heading.
//
// Why the screen exists. The product had views for a handful of chosen
// metrics, so a type could be ingested for years and still be unreachable —
// hydration was recorded thousands of times and appeared nowhere. Any screen
// built on a chosen list reproduces that bug the next time the taxonomy grows.
// So this one is driven entirely by the database: metric_types intersected
// with the subject's own rows (queries/inventory), headings and glyphs derived
// by rule from the identifier (lib/metrics). A type promoted tomorrow appears
// here on its own.
//
// No time navigation on purpose. The catalogue answers "what do I have",
// which is a question about the whole history: each row states its own
// coverage and its own last ninety recorded days. The window belongs to the
// detail screen, where it changes what is being read.
//
// The loading state is an explicit <Suspense> here rather than a loading.tsx,
// and that is a correctness constraint, not a preference: a loading file covers
// a segment AND ITS CHILDREN, so it would stream the shell of /metrics/[type]
// too — status line included — and notFound() there could no longer answer 404
// on an unknown type. Measured: it answered 200.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { EmptyState } from '@/components/data/EmptyState';
import { Skeleton, SkeletonLines } from '@/components/data/Skeleton';
import { StatTile } from '@/components/data/StatTile';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { displayUnit, fmtCompact, fmtDay, fmtInt, metricWriter } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import {
  dataColor,
  metricDisplay,
  metricHref,
  metricLabel,
  METRIC_GROUPS,
  metricSlug,
} from '@/lib/metrics';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import {
  DORMANT_DAYS,
  metricInventory,
  SPARK_DAYS,
  summarize,
  type InventoryEntry,
} from '@/lib/queries/inventory';
import { dataTotals } from '@/lib/queries/sync';
import { addDays, daysBetween, todayInZone } from '@/lib/queries/time';
import { MetricCatalog, type CatalogGroupData, type CatalogRow } from './ui';

export const metadata: Metadata = { title: 'Toutes mes données · Hygie' };
export const dynamic = 'force-dynamic';

/** Coverage as "Dec 2012 → Aug 2026": the years are what a reader compares. */
function coverageLabel(entry: InventoryEntry, locale: Locale): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };
  const from = fmtDay(entry.firstDay, locale, opts);
  const to = fmtDay(entry.lastDay, locale, opts);
  return from === to ? from : `${from} → ${to}`;
}

/**
 * The row's headline figure: the value of the last day carrying a measure,
 * converted to its display unit. For a daily cumulative that is a total, for
 * a point measure the mean of that day, for a state the last reading, and for
 * an occurrence type a count — the same reduction the chart of that type would
 * draw, so the two agree.
 */
function lastValueLabel(entry: InventoryEntry, locale: Locale): string | null {
  if (entry.lastValue === null) return null;
  const writer = metricWriter(entry.aggregation, entry.unit, entry.lastValue, locale);
  return writer.write(entry.lastValue);
}

/** Sparkline values in display units: a curve in kJ under a value in kcal would jar. */
function sparkValues(entry: InventoryEntry): Array<number | null> {
  const display = displayUnit(entry.unit);
  return entry.recent.map((v) => (v === null ? null : display.convert(v)));
}

/**
 * Sleep stages and workouts live in tables of their own (sleep_segments,
 * workouts), not in observations, so no metric type describes them and they
 * would be missing from an inventory that only reads the taxonomy. The screen
 * promises that nothing is hidden, so they are stated, with the screens that
 * actually render them.
 */
function DedicatedPanel({
  sleepSegments,
  sleepNights,
  workouts,
  locale,
  m,
}: {
  sleepSegments: number;
  sleepNights: number;
  workouts: number;
  locale: Locale;
  m: Messages;
}) {
  const links: Array<{ href: string; icon: string; label: string; value: number; sub?: string }> = [
    {
      href: '/sleep',
      icon: 'bedtime',
      label: m.catalog.sleepSegments,
      value: sleepSegments,
      sub: `${fmtInt(sleepNights, locale)} ${m.catalog.sleepNights.toLowerCase()}`,
    },
    { href: '/sport', icon: 'exercise', label: m.catalog.workouts, value: workouts },
  ].filter((l) => l.value > 0);
  if (links.length === 0) return null;
  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 28, flexWrap: 'wrap' }}>
        <span className="hy-label" style={{ flex: '1 1 200px', paddingTop: 2 }}>
          {m.catalog.dedicatedTitle}
        </span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="hy-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 8px',
              margin: -4,
              borderRadius: 'var(--r-md)',
              textDecoration: 'none',
              color: 'var(--text-1)',
            }}
          >
            <Icon name={link.icon} size={16} color={dataColor(link.href === '/sleep' ? 'sleep' : 'activity')} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="hy-label">{link.label}</span>
              <span className="tnum" style={{ font: '600 var(--text-md)/1.1 var(--font-ui)' }}>
                {fmtInt(link.value, locale)}
                {link.sub && (
                  <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 6 }}>
                    {link.sub}
                  </span>
                )}
              </span>
            </span>
            <Icon name="chevron_right" size={15} color="var(--text-3)" />
          </Link>
        ))}
      </div>
      <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0', maxWidth: 860 }}>
        {m.catalog.dedicatedNote}
      </p>
    </Panel>
  );
}

function toRow(entry: InventoryEntry, locale: Locale, today: string, m: Messages): CatalogRow {
  const display = metricDisplay(entry.hkIdentifier);
  const label = metricLabel(entry.hkIdentifier, locale);
  const unit = displayUnit(entry.unit).unit;
  return {
    hk: entry.hkIdentifier,
    // The link opens the detail on the window this row already draws, anchored
    // on the type's OWN last day. Without it the detail screen would open on
    // the default rolling 30 days, which for a type last recorded in February
    // is an empty page reached by clicking a row full of values.
    href: metricHref(
      entry.hkIdentifier,
      `from=${addDays(entry.lastDay, -(SPARK_DAYS - 1))}&to=${entry.lastDay}`
    ),
    label,
    // The identifier is in the haystack on purpose: someone who knows
    // HealthKit will type "DietaryWater", not "eau bue".
    haystack: [label, entry.hkIdentifier, metricSlug(entry.hkIdentifier), unit ?? '', m.groups[display.group] ?? '']
      .join(' ')
      .toLowerCase(),
    icon: display.icon,
    color: dataColor(display.family),
    unit,
    lastValue: lastValueLabel(entry, locale),
    lastWhen: entry.lastValueDay === null ? null : fmtDay(entry.lastValueDay, locale),
    measures: fmtInt(entry.measures, locale),
    coverage: coverageLabel(entry, locale),
    spark: sparkValues(entry),
    dormant: daysBetween(entry.lastDay, today) > DORMANT_DAYS,
    occurrences: entry.kind !== 'quantity' || entry.aggregation === 'none',
  };
}

/** Shimmering stand-in for the body, in the layout it becomes. */
function CatalogueSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width={90} height={11} />
              <Skeleton width={120} height={20} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel padding="10px 12px">
        <Skeleton height={26} radius="var(--r-md)" />
      </Panel>
      {[0, 1, 2].map((i) => (
        <Panel key={i} padding="12px 10px">
          <Skeleton width={120} height={11} style={{ marginBottom: 12 }} />
          <SkeletonLines lines={4} height={20} gap={10} />
        </Panel>
      ))}
    </div>
  );
}

async function CatalogueBody({
  ctx,
  locale,
  m,
  today,
}: {
  ctx: SubjectContext;
  locale: Locale;
  m: Messages;
  today: string;
}) {
  const [entries, totals] = await Promise.all([metricInventory(ctx, today), dataTotals(ctx)]);
  const summary = summarize(entries, today);

  // Headings in the fixed order of the taxonomy, types alphabetical by their
  // LABEL inside: the reader scans words, not identifiers, and the order must
  // not shuffle itself as the taxonomy grows.
  const collator = new Intl.Collator(locale === 'fr' ? 'fr' : 'en');
  const rows = entries.map((e) => ({ entry: e, row: toRow(e, locale, today, m) }));
  const groups: CatalogGroupData[] = METRIC_GROUPS.map((group) => ({
    key: group,
    label: m.groups[group] ?? group,
    rows: rows
      .filter(({ entry }) => metricDisplay(entry.hkIdentifier).group === group)
      .map(({ row }) => row)
      .sort((a, b) => collator.compare(a.label, b.label)),
  })).filter((g) => g.rows.length > 0);

  const period =
    summary.firstDay && summary.lastDay
      ? `${fmtDay(summary.firstDay, locale, { month: 'short', year: 'numeric' })} → ${fmtDay(summary.lastDay, locale, { month: 'short', year: 'numeric' })}`
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.length === 0 ? (
        <Panel>
          <EmptyState icon="database" title={m.catalog.empty} hint={m.catalog.emptyHint} />
        </Panel>
      ) : (
        <>
          <Panel>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <StatTile label={m.catalog.typesTile} value={fmtInt(summary.types, locale)} />
              <StatTile
                label={m.catalog.measuresTile}
                value={fmtCompact(summary.measures, locale)}
                sub={fmtInt(summary.measures, locale)}
              />
              <StatTile label={m.catalog.periodTile} value={period} />
              <StatTile
                label={m.catalog.dormantTile}
                value={fmtInt(summary.dormant, locale)}
                sub={m.catalog.dormantHint(DORMANT_DAYS)}
              />
              <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'flex-end' }}>
                <Link
                  href="/explore"
                  className="hy-ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 7px',
                    borderRadius: 'var(--r-sm)',
                    textDecoration: 'none',
                    color: 'var(--text-2)',
                    font: '500 var(--text-xs)/1 var(--font-ui)',
                  }}
                >
                  <Icon name="query_stats" size={14} />
                  {m.nav.explore}
                  <Icon name="arrow_forward" size={13} />
                </Link>
              </div>
            </div>
          </Panel>

          <MetricCatalog
            groups={groups}
            total={entries.length}
            labels={{
              search: m.catalog.search,
              searchPlaceholder: m.catalog.searchPlaceholder,
              allGroups: m.catalog.allGroups,
              colMetric: m.catalog.colMetric,
              colLast: m.catalog.colLast,
              colWhen: m.catalog.colWhen,
              colMeasures: m.catalog.colMeasures,
              colCoverage: m.catalog.colCoverage,
              colTrend: m.catalog.colTrend(SPARK_DAYS),
              matched: m.catalog.matched,
              noMatch: m.catalog.noMatch,
              noMatchHint: m.catalog.noMatchHint,
              dormantBadge: m.catalog.dormantBadge,
              occurrencesBadge: m.catalog.occurrencesBadge,
            }}
          />

          <DedicatedPanel
            sleepSegments={totals.sleepSegments}
            sleepNights={totals.sleepNights}
            workouts={totals.workouts}
            locale={locale}
            m={m}
          />

          <p
            style={{
              font: '400 var(--text-2xs)/1.5 var(--font-ui)',
              color: 'var(--text-3)',
              margin: 0,
              maxWidth: 860,
            }}
          >
            {m.catalog.dailyValueHint}
          </p>
        </>
      )}
    </div>
  );
}

export default async function MetricsCataloguePage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.catalog.title}</h1>
        <p
          style={{
            font: '400 var(--text-sm)/1.45 var(--font-ui)',
            color: 'var(--text-3)',
            margin: 0,
            maxWidth: 760,
          }}
        >
          {m.catalog.subtitle}
        </p>
      </header>

      <Suspense fallback={<CatalogueSkeleton label={m.catalog.loading} />}>
        <CatalogueBody ctx={ctx} locale={locale} m={m} today={today} />
      </Suspense>
    </div>
  );
}
