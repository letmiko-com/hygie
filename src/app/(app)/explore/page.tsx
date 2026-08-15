// Explorer: a chart builder. Pick N metrics that carry data for you, pick a
// window with the same time navigation as everywhere else, read the shapes
// on top of each other. The screen answers "do these two move together?" and
// stops there — no composite score, no readiness index, no advice. Hygie is
// an instrument, not a coach (design charter), and a score would be an
// opinion dressed as a measure.
//
// Everything is URL state: ?m=<keys> selects the series, ?scale=normalized
// forces the comparable-shapes rendering, the usual ?p/?a/?from/?to/&compare
// carry the window. A shared link reopens the exact same view.
//
// Granularity is derived from the width of the window (see queries/explore),
// never asked; the chosen grain is displayed so no one mistakes an hourly
// mean for a raw sample.
import type { Metadata } from 'next';
import Link from 'next/link';
import { MultiLineChart, planScale, type OverlaySeries } from '@/components/charts/MultiLineChart';
import { drillZone } from '@/lib/drill';
import { DataTable, type Column } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { TrendChip } from '@/components/data/TrendChip';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { displayUnit, fmtDay, fmtInt, magnitudeFormat, type UnitDisplay } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor, metricFamily, metricHref, metricIcon, metricLabel, type DataFamily } from '@/lib/metrics';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import {
  DERIVED_SLEEP,
  DERIVED_TRAINING,
  isDerived,
  subjectCatalog,
  type CatalogEntry,
} from '@/lib/queries/catalog';
import { chooseGranularity, exploreChart, type ExploreSeries, type Granularity } from '@/lib/queries/explore';
import { comparisonRange, elapsedDays, todayInZone } from '@/lib/queries/time';
import { parseTimeParams, timeQuery, type TimeSearchParams } from '@/lib/queries/time-params';
import { dataTotals } from '@/lib/queries/sync';
import { monthlyTrainingSilhouette } from '@/lib/queries/workouts';
import { MetricPicker, ScaleToggle, type PickerOption } from './ui';

export const metadata: Metadata = { title: 'Explorateur · Hygie' };
export const dynamic = 'force-dynamic';

/** Beyond six curves the chart stops being readable, whatever the scale. */
const MAX_SERIES = 6;
const DEFAULT_SELECTION = ['HKQuantityTypeIdentifierRestingHeartRate', DERIVED_SLEEP];

/**
 * Series colors. A metric keeps its family color when that color is still
 * free, so heart rate stays red; collisions (two heart metrics) fall back to
 * the next free family token, because two red curves would be unreadable.
 */
const PALETTE: DataFamily[] = [
  'heart',
  'activity',
  'distance',
  'energy',
  'sleep',
  'power',
  'water',
  'neutral',
];

function assignColors(keys: string[], familyOf: (key: string) => DataFamily): Map<string, string> {
  const used = new Set<DataFamily>();
  const out = new Map<string, string>();
  for (const key of keys) {
    const own = familyOf(key);
    let family = used.has(own) ? PALETTE.find((f) => !used.has(f)) : own;
    family = family ?? 'neutral';
    used.add(family);
    out.set(key, dataColor(family));
  }
  return out;
}

function labelOf(key: string, locale: Locale, m: Messages): string {
  if (key === DERIVED_SLEEP) return m.explore.derivedSleep;
  if (key === DERIVED_TRAINING) return m.explore.derivedTraining;
  return metricLabel(key, locale);
}

function familyOf(key: string): DataFamily {
  if (key === DERIVED_SLEEP) return 'sleep';
  if (key === DERIVED_TRAINING) return 'activity';
  return metricFamily(key);
}

function iconOf(key: string): string {
  if (key === DERIVED_SLEEP) return 'bedtime';
  if (key === DERIVED_TRAINING) return 'exercise';
  return metricIcon(key);
}

/** Five evenly spaced ticks, formatted for the grain being charted. */
function axisLabels(
  days: string[] | null,
  buckets: Date[] | null,
  granularity: Granularity,
  locale: Locale,
  timeZone: string
): string[] {
  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  if (days) {
    const long = days.length > 366;
    return fractions.map((f) => {
      const day = days[Math.min(days.length - 1, Math.round(f * (days.length - 1)))];
      return day
        ? fmtDay(day, locale, long ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' })
        : '';
    });
  }
  if (!buckets || buckets.length === 0) return [];
  const options: Intl.DateTimeFormatOptions =
    granularity === 'minute'
      ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }
      : { day: 'numeric', month: 'short', hour: '2-digit', hour12: false, timeZone };
  const fmt = new Intl.DateTimeFormat(intl, options);
  return fractions.map((f) => {
    const bucket = buckets[Math.min(buckets.length - 1, Math.round(f * (buckets.length - 1)))];
    return bucket ? fmt.format(bucket) : '';
  });
}

/** Smoothing window: enough to read a trajectory, never enough to erase a gap. */
function rollingWindow(length: number): number | undefined {
  if (length <= 90) return undefined;
  return Math.max(2, Math.round(length / 60));
}

interface StatRow extends Record<string, unknown> {
  key: string;
  label: string;
  color: string;
  unit: string | null;
  isTotal: boolean;
  value: string | null;
  min: string | null;
  max: string | null;
  measured: number;
  total: number;
  deltaPct: number | null;
}

function parseSelection(raw: string | string[] | undefined, catalog: CatalogEntry[]): string[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return DEFAULT_SELECTION.filter((k) => catalog.some((c) => c.key === k));
  if (value === 'none' || value === '') return [];
  const known = new Set(catalog.map((c) => c.key));
  const out: string[] = [];
  for (const key of value.split(',')) {
    const trimmed = key.trim();
    if (known.has(trimmed) && !out.includes(trimmed) && out.length < MAX_SERIES) out.push(trimmed);
  }
  return out;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<TimeSearchParams>;
}) {
  const ctx: SubjectContext | null = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const sp = await searchParams;
  const [totals, catalog] = await Promise.all([dataTotals(ctx), subjectCatalog(ctx, today)]);
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);
  const granularity = chooseGranularity(range);
  const elapsed = elapsedDays(range, today);
  const prevRange = comparisonRange(preset, range, elapsed);

  // A charted series is a metric: its name in the stats table opens its own
  // page, on the same window. Derived series (sleep, training time) are facts
  // the app computes, not types in the taxonomy, so they carry no link.
  const windowQuery = timeQuery(sp);

  const rawScale = Array.isArray(sp.scale) ? sp.scale[0] : sp.scale;
  const scale: 'auto' | 'normalized' = rawScale === 'normalized' ? 'normalized' : 'auto';

  const selection = parseSelection(sp.m, catalog);
  // A daily-only series has nothing to say inside an hour: it is offered
  // again as soon as the window is charted per day.
  const charted = selection.filter((key) => granularity === 'day' || !isDerived(key));

  const [chart, silhouette] = await Promise.all([
    charted.length > 0
      ? exploreChart(ctx, charted, range, prevRange, elapsed)
      : Promise.resolve(null),
    monthlyTrainingSilhouette(ctx),
  ]);

  // Families in a fixed order, metrics alphabetical inside: the picker must
  // not reshuffle itself as the taxonomy grows, and heart metrics must not
  // end up below a scroll line because their identifiers sort late.
  const options: PickerOption[] = catalog
    .map((entry) => ({
      key: entry.key,
      label: labelOf(entry.key, locale, m),
      icon: iconOf(entry.key),
      color: dataColor(familyOf(entry.key)),
      unit: displayUnit(entry.unit).unit,
      group: m.explore.families[familyOf(entry.key)] ?? familyOf(entry.key),
      dailyOnly: entry.dailyOnly,
      disabled: entry.dailyOnly && granularity !== 'day',
    }))
    .sort((a, b) => {
      const rank = PALETTE.indexOf(familyOf(a.key)) - PALETTE.indexOf(familyOf(b.key));
      if (rank !== 0) return rank;
      return a.label.localeCompare(b.label, locale === 'fr' ? 'fr' : 'en');
    });

  const colors = assignColors(charted, familyOf);

  const converted: Array<{ series: ExploreSeries; display: UnitDisplay; values: Array<number | null> }> =
    (chart?.series ?? []).map((series) => {
      const display = displayUnit(series.unit);
      return {
        series,
        display,
        values: series.values.map((v) => (v === null ? null : display.convert(v))),
      };
    });

  const overlay: OverlaySeries[] = converted.map(({ series, display, values }) => ({
    key: series.key,
    label: labelOf(series.key, locale, m),
    color: colors.get(series.key) ?? dataColor('neutral'),
    unit: display.unit,
    values,
    rolling: rollingWindow(values.length),
  }));

  const plan = planScale(overlay, scale === 'normalized' ? 'normalized' : null);
  const makeFormat = (maxAbs: number) => magnitudeFormat(maxAbs, locale);

  // Day buckets drill into that single day, keeping the metric selection and
  // scale: on a one-day window the granularity switches to minute by itself.
  const chartDrill =
    chart !== null && chart.granularity === 'day' && chart.days !== null
      ? chart.days.map((d) => {
          const q = new URLSearchParams();
          for (const [k, v] of Object.entries(sp)) {
            if (['p', 'a', 'from', 'to', 'compare'].includes(k)) continue;
            const val = Array.isArray(v) ? v[0] : v;
            if (val !== undefined && val !== '') q.set(k, val);
          }
          q.set('from', d);
          q.set('to', d);
          return drillZone({ fromDay: d, toDay: d }, `/explore?${q.toString()}`, locale, m);
        })
      : undefined;

  const statRows: StatRow[] = converted.map(({ series, display, values }) => {
    const isTotal = series.aggregation === 'sum' || series.aggregation === 'duration';
    const convert = (v: number | null): number | null => (v === null ? null : display.convert(v));
    const current = convert(series.current);
    // Each row is formatted on its own magnitude: 6.2 h of sleep must not be
    // rounded to 6 because another series counts in thousands of kcal.
    const format = magnitudeFormat(
      Math.max(1, ...values.filter((v): v is number => v !== null).map(Math.abs), Math.abs(current ?? 0)),
      locale
    );
    return {
      key: series.key,
      label: labelOf(series.key, locale, m),
      color: colors.get(series.key) ?? dataColor('neutral'),
      unit: display.unit,
      isTotal,
      value: current === null ? null : format(current),
      min: series.min === null ? null : format(display.convert(series.min)),
      max: series.max === null ? null : format(display.convert(series.max)),
      measured: series.measured,
      total: chart?.axisLength ?? 0,
      deltaPct: series.deltaPct,
    };
  });

  const columns: Array<Column<StatRow>> = [
    {
      key: 'label',
      label: m.explore.colMetric,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden style={{ width: 10, height: 2, background: row.color, flex: 'none' }} />
          {isDerived(row.key) ? (
            row.label
          ) : (
            <Link
              href={metricHref(row.key, windowQuery)}
              title={m.common.seeDetail}
              style={{ color: 'var(--text-1)', textDecoration: 'none', borderBottom: '1px dotted var(--border-strong)' }}
            >
              {row.label}
            </Link>
          )}
        </span>
      ),
    },
    {
      key: 'value',
      label: `${m.explore.colMean} / ${m.explore.colTotal}`,
      align: 'right',
      mono: true,
      render: (row) =>
        row.value === null ? null : (
          <span>
            {row.value}
            {row.unit && <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{row.unit}</span>}
          </span>
        ),
    },
    { key: 'min', label: m.explore.colMin, align: 'right', mono: true, muted: true },
    { key: 'max', label: m.explore.colMax, align: 'right', mono: true, muted: true },
    {
      key: 'coverage',
      label: m.explore.colCoverage,
      align: 'right',
      mono: true,
      muted: true,
      render: (row) =>
        row.total === 0 ? null : m.explore.coverage(fmtInt(row.measured, locale), fmtInt(row.total, locale)),
    },
    {
      key: 'trend',
      label: m.explore.colTrend,
      align: 'right',
      render: (row) =>
        row.deltaPct === null ? null : (
          <TrendChip deltaPct={row.deltaPct} locale={locale} />
        ),
    },
  ];

  const scaleNote =
    plan.mode === 'normalized'
      ? m.explore.noteNormalized
      : plan.axisUnits[1] !== null
        ? m.explore.noteDual(plan.axisUnits[0] ?? '—', plan.axisUnits[1] ?? '—')
        : m.explore.noteSingle(plan.axisUnits[0] ?? '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.explore.title}</h1>
            <p style={{ font: '400 var(--text-sm)/1.45 var(--font-ui)', color: 'var(--text-3)', margin: '4px 0 0', maxWidth: 720 }}>
              {m.explore.subtitle}
            </p>
          </div>
          <TimeNav
            preset={preset}
            range={range}
            compare={compare}
            firstDataDay={totals.firstDay}
            today={today}
            locale={locale}
            labels={m.timenav}
          />
        </div>
        {totals.firstDay && (
          <TimeScrubber
            startDay={totals.firstDay}
            endDay={today}
            range={range}
            data={silhouette}
            compare={compare}
            startLabel={fmtDay(totals.firstDay, locale, { month: 'short', year: 'numeric' })}
            endLabel={fmtDay(today, locale, { month: 'short', year: 'numeric' })}
            ariaLabel={m.timenav.scrubber}
          />
        )}
      </header>

      <Panel>
        <MetricPicker
          options={options}
          selected={selection}
          max={MAX_SERIES}
          labels={{
            title: m.explore.pickTitle,
            picked: m.explore.picked(selection.length, MAX_SERIES),
            clear: m.explore.clear,
            maxReached: m.explore.maxReached(MAX_SERIES),
            dailyOnlyBadge: m.explore.dailyOnlyBadge,
            dailyOnlyHint: m.explore.dailyOnlyHint,
          }}
        />
      </Panel>

      {charted.length === 0 || chart === null ? (
        <Panel>
          <EmptyState icon="query_stats" title={m.explore.emptyTitle} hint={m.explore.emptyHint} />
        </Panel>
      ) : (
        <>
          <Panel>
            <PanelLabel
              trailing={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="hy-label">{m.explore.granularity}</span>
                    <Badge tone="neutral">{m.explore.granularities[chart.granularity]}</Badge>
                    <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)' }}>
                      {m.explore.granularityAuto}
                    </span>
                  </span>
                  <ScaleToggle
                    scale={scale}
                    labels={{
                      title: m.explore.scale,
                      auto: m.explore.scaleAuto,
                      normalized: m.explore.scaleNormalized,
                    }}
                  />
                </span>
              }
            >
              {m.explore.chartTitle}
            </PanelLabel>
            <MultiLineChart
              series={overlay}
              plan={plan}
              xLabels={axisLabels(chart.days, chart.buckets, chart.granularity, locale, ctx.timezone)}
              height={320}
              ariaLabel={m.explore.chartTitle}
              emptyLabel={m.explore.noData}
              makeFormat={makeFormat}
              drill={chartDrill}
            />
            <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
              {scaleNote}
            </p>
          </Panel>

          <Panel>
            <PanelLabel>{m.explore.statsTitle}</PanelLabel>
            <DataTable columns={columns} rows={statRows} rowKey={(row) => row.key} dense />
            <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
              {m.explore.coverageHint}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
