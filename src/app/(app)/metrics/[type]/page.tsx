// Detail of one measure type: the reference page for anything the subject
// records. Generic by construction — what gets rendered is decided from the
// taxonomy row (kind, aggregation, canonical unit, HAE regime), never from a
// list of known identifiers, so a type promoted in the database gets a correct
// page with no code change here.
//
// Two shapes, because the data has two shapes:
//   - a quantity with a declared aggregation gets a chart (bars for a daily
//     cumulative, a curve for a point measure), a total or a mean, its
//     extremes, a trend against the previous window and a calendar;
//   - anything else (the *Event category types, MindfulSession, AppleStandHour,
//     a quantity still carrying aggregation 'none') has no average to state:
//     it gets occurrences per day and a chronology.
//
// The window is the app's shared time navigation and is honoured for real:
// every figure, the chart, the sources and the sample list are read inside it,
// and the chart grain follows its width exactly as the explorer's does.
//
// The sources panel is behind its own Suspense boundary. It is the one read
// whose cost grows with the window (no index carries source_id: 6 ms over a
// month of heart rate, 942 ms all-time, measured), and it is secondary: the
// numbers and the chart must not wait for it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { LineChart } from '@/components/charts/LineChart';
import { DataTable, type Column } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { SourceBadge } from '@/components/data/SourceBadge';
import { Skeleton } from '@/components/data/Skeleton';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import {
  ABSENT,
  displayUnit,
  fmtDateTime,
  fmtDay,
  fmtDuration,
  fmtHoursMinutes,
  fmtInt,
  fmtNumber,
  fmtPercent,
  metricWriter,
} from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import {
  dataColor,
  metricDisplay,
  metricFromSlug,
  metricHref,
  metricLabel,
  metricSlug,
  type MetricQuality,
} from '@/lib/metrics';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import { chooseGranularity, exploreChart, type Granularity } from '@/lib/queries/explore';
import { subjectTypeIdentifiers } from '@/lib/queries/inventory';
import {
  isChartable,
  isCumulative,
  metricCategoryBreakdown,
  metricOccurrences,
  metricOccurrenceStats,
  metricSamples,
  metricSources,
  metricWindowStats,
  type MetricExtreme,
} from '@/lib/queries/metric-detail';
import { getMetricType } from '@/lib/queries/metric-types';
import { dataTotals } from '@/lib/queries/sync';
import { comparisonRange, elapsedDays, todayInZone, type DayRange } from '@/lib/queries/time';
import { parseTimeParams, type TimeSearchParams } from '@/lib/queries/time-params';
import { dayAxisLabels } from '@/lib/time-format';
import { sportDisplay, sportLabel } from '@/lib/sports';
import { monthlyTrainingSilhouette } from '@/lib/queries/workouts';

export const metadata: Metadata = { title: 'Métrique · Hygie' };
export const dynamic = 'force-dynamic';

/** Above this many buckets a bar is thinner than its own gap: draw a curve. */
const MAX_BARS = 120;
/** A calendar is unreadable below two months and unmanageable past ~13 months. */
const HEATMAP_MIN_DAYS = 60;
const HEATMAP_MAX_DAYS = 400;
/** Points a stretched SVG can actually resolve. */
const MAX_CHART_POINTS = 366;

/** Bucket-mean downsampling. Gaps stay gaps: an all-null bucket stays null. */
function downsample(values: Array<number | null>, target: number): Array<number | null> {
  if (values.length <= target) return values;
  const size = Math.ceil(values.length / target);
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i += size) {
    const bucket = values.slice(i, i + size).filter((v): v is number => v !== null);
    out.push(bucket.length === 0 ? null : bucket.reduce((a, b) => a + b, 0) / bucket.length);
  }
  return out;
}

/** Smoothing window: enough to read a trajectory, never enough to erase a gap. */
function rollingWindow(length: number): number | undefined {
  if (length <= 21) return undefined;
  return Math.max(2, Math.min(14, Math.round(length / 12)));
}

function mondayOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return new Date(t - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** Five evenly spaced labels for a bucket axis (hour and minute grains). */
function bucketAxisLabels(
  buckets: Date[],
  granularity: Granularity,
  locale: Locale,
  timeZone: string
): string[] {
  if (buckets.length === 0) return [];
  const options: Intl.DateTimeFormatOptions =
    granularity === 'minute'
      ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }
      : { day: 'numeric', month: 'short', hour: '2-digit', hour12: false, timeZone };
  const fmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', options);
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const b = buckets[Math.min(buckets.length - 1, Math.round(f * (buckets.length - 1)))];
    return b ? fmt.format(b) : '';
  });
}

function trendProps(quality: MetricQuality): { invert: boolean; neutral: boolean } {
  return {
    invert: quality === 'lower-better',
    neutral: quality === 'neutral',
  };
}

/** Extreme tile subtitle: the day, the instant, and the session when there is one. */
function ExtremeSub({
  extreme,
  locale,
  timeZone,
  m,
}: {
  extreme: MetricExtreme;
  locale: Locale;
  timeZone: string;
  m: Messages;
}) {
  const when =
    extreme.ts === null ? fmtDay(extreme.day, locale) : fmtDateTime(extreme.ts, locale, timeZone, true);
  if (extreme.workoutId === null) return <>{when}</>;
  const activity = extreme.workoutActivity ?? '';
  return (
    <>
      {when}
      {' · '}
      <Link
        href={`/sport/${extreme.workoutId}`}
        title={m.metric.duringSession(sportLabel(activity, locale))}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          color: 'var(--accent-strong)',
          textDecoration: 'none',
          font: '500 var(--text-2xs)/1.3 var(--font-ui)',
        }}
      >
        <Icon name={sportDisplay(activity).icon} size={12} />
        {m.metric.seeSession}
      </Link>
    </>
  );
}

// --- sources panel (streamed) -------------------------------------------------

async function SourcesPanel({
  ctx,
  hk,
  range,
  locale,
  m,
}: {
  ctx: SubjectContext;
  hk: string;
  range: DayRange;
  locale: Locale;
  m: Messages;
}) {
  const sources = await metricSources(ctx, hk, range);
  interface Row extends Record<string, unknown> {
    name: string;
    rows: string;
    share: string;
    first: string;
    last: string;
    minuteChannel: boolean;
  }
  const rows: Row[] = sources.map((s) => ({
    name: s.name,
    rows: fmtInt(s.rows, locale),
    share: fmtPercent(s.sharePct, locale, 1),
    first: fmtDateTime(s.firstTs, locale, ctx.timezone, true),
    last: fmtDateTime(s.lastTs, locale, ctx.timezone, true),
    minuteChannel: s.minuteChannel,
  }));
  const columns: Array<Column<Row>> = [
    {
      key: 'name',
      label: m.metric.colSource,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <SourceBadge name={row.name} />
          {row.minuteChannel && <Badge tone="neutral">{m.metric.minuteChannelBadge}</Badge>}
        </span>
      ),
    },
    { key: 'rows', label: m.metric.colRows, align: 'right', mono: true },
    { key: 'share', label: m.metric.colShare, align: 'right', mono: true, muted: true },
    { key: 'first', label: m.metric.colFirst, mono: true, muted: true },
    { key: 'last', label: m.metric.colLastSeen, mono: true, muted: true },
  ];
  return (
    <>
      <PanelLabel>{m.metric.sourcesTitle}</PanelLabel>
      {rows.length === 0 ? (
        <p style={{ font: 'italic 400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)', margin: 0 }}>
          {m.metric.sourcesEmpty}
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} dense />
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {m.metric.sourcesNote}
          </p>
        </>
      )}
    </>
  );
}

// --- page --------------------------------------------------------------------

export default async function MetricDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<TimeSearchParams>;
}) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const { type: slug } = await params;
  // Resolved against the types this subject HAS data for: a type that exists in
  // the taxonomy but carries nothing here must 404, not render an empty page
  // that pretends the measure is being recorded.
  const known = await subjectTypeIdentifiers(ctx, today);
  const hk = metricFromSlug(slug, known);
  if (hk === null) notFound();

  const [type, totals, sp, silhouette] = await Promise.all([
    getMetricType(hk),
    dataTotals(ctx),
    searchParams,
    monthlyTrainingSilhouette(ctx),
  ]);
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);
  const elapsed = elapsedDays(range, today);
  const prevRange = comparisonRange(preset, range, elapsed);

  const display = metricDisplay(hk);
  const label = metricLabel(hk, locale);
  const color = dataColor(display.family);
  const unitDisplay = displayUnit(type.canonicalUnit);
  const chartable = isChartable(type);
  const cumulative = isCumulative(type.aggregation);
  const granularity = chartable ? chooseGranularity(range) : 'day';

  const header = (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Link
        href="/metrics"
        className="hy-ghost"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          padding: '2px 6px',
          margin: '0 0 0 -6px',
          borderRadius: 'var(--r-sm)',
          textDecoration: 'none',
          color: 'var(--text-3)',
          font: '400 var(--text-xs)/1 var(--font-ui)',
        }}
      >
        <Icon name="arrow_back" size={13} />
        {m.metric.back}
      </Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <h1
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              font: '600 var(--text-xl)/1.2 var(--font-ui)',
              margin: 0,
            }}
          >
            <Icon name={display.icon} size={20} color={color} />
            {label}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              className="tnum"
              style={{ font: '400 var(--text-2xs)/1.3 var(--font-data)', color: 'var(--text-3)' }}
            >
              {metricSlug(hk)}
            </span>
            <Badge tone="neutral" mono>
              {unitDisplay.unit ?? m.metric.dimensionless}
            </Badge>
            <Badge tone="neutral">{m.aggregations[type.aggregation] ?? type.aggregation}</Badge>
          </div>
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
    </header>
  );

  const scrubber = totals.firstDay ? (
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
  ) : null;


  // A window with nothing in it must offer the one window that always has
  // something: the whole history.
  const allPeriodAction = (
    <Link
      href={`${metricHref(hk)}?p=all`}
      className="hy-btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 'var(--control-h-md)',
        padding: '0 11px',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border-strong)',
        background: 'var(--surface)',
        color: 'var(--text-1)',
        textDecoration: 'none',
        font: '500 var(--text-sm)/1 var(--font-ui)',
      }}
    >
      <Icon name="all_inclusive" size={14} color="var(--text-3)" />
      {m.metric.seeAllPeriod}
    </Link>
  );

  const sourcesPanel = (
    <Panel>
      <Suspense
        fallback={
          <div aria-busy="true" aria-label={m.metric.sourcesLoading}>
            <Skeleton width={160} height={11} style={{ marginBottom: 12 }} />
            <Skeleton height={58} radius="var(--r-md)" />
          </div>
        }
      >
        <SourcesPanel ctx={ctx} hk={hk} range={range} locale={locale} m={m} />
      </Suspense>
    </Panel>
  );

  // --- occurrence types ------------------------------------------------------
  if (!chartable) {
    const [stats, occurrences, breakdown] = await Promise.all([
      metricOccurrenceStats(ctx, hk, range, prevRange, elapsed),
      metricOccurrences(ctx, hk, range),
      metricCategoryBreakdown(ctx, hk, range),
    ]);
    const duration = stats.mode === 'duration';
    // Seconds read as "1 h 12", counts as integers. Both are aggregated by the
    // bucket mean when the window is wider than the chart can resolve.
    const writeOcc = (v: number | null): string | null =>
      v === null ? null : duration ? fmtHoursMinutes(v) : fmtInt(v, locale);
    const values = downsample(stats.counts, MAX_CHART_POINTS);
    const xLabels = dayAxisLabels(
      stats.days,
      locale,
      5,
      stats.days.length > 366 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }
    );
    interface OccRow extends Record<string, unknown> {
      key: string;
      when: string;
      kind: string | null;
      duration: string | null;
      source: string;
    }
    const occRows: OccRow[] = occurrences.map((o, i) => ({
      key: `${o.ts.toISOString()}-${i}`,
      when: fmtDateTime(o.ts, locale, ctx.timezone, true),
      kind: o.slug,
      duration: o.durationS === null ? null : fmtDuration(o.durationS),
      source: o.sourceName,
    }));
    const occColumns: Array<Column<OccRow>> = [
      { key: 'when', label: m.metric.colTime, mono: true },
      { key: 'kind', label: m.metric.colKind, mono: true, muted: true },
      { key: 'duration', label: m.metric.colDuration, align: 'right', mono: true, muted: true },
      {
        key: 'source',
        label: m.metric.colSource,
        render: (row) => <SourceBadge name={row.source} />,
      },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {header}
        {scrubber}
        <Panel>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <StatTile
              label={duration ? m.metric.timeSpent : m.metric.occurrences}
              value={stats.daysMeasured === 0 ? null : writeOcc(stats.total)}
              color={color}
              sub={
                <TrendChip
                  deltaPct={stats.deltaPct}
                  invert={display.quality === 'lower-better'}
                  neutral={display.quality === 'neutral'}
                  label={m.metric.vsPrevPeriod}
                  locale={locale}
                />
              }
            />
            <StatTile
              label={m.metric.daysMeasured}
              value={m.metric.coverage(fmtInt(stats.daysMeasured, locale), fmtInt(stats.daysTotal, locale))}
            />
            {breakdown.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160 }}>
                <span className="hy-label">{m.metric.breakdownTitle}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {breakdown.map((b) => (
                    <span
                      key={b.slug ?? 'unknown'}
                      className="tnum"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'baseline',
                        gap: 5,
                        padding: '2px 7px',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--surface-2)',
                        font: '400 var(--text-xs)/1.4 var(--font-ui)',
                        color: 'var(--text-2)',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-data)' }}>{b.slug ?? ABSENT}</span>
                      <span style={{ font: '600 var(--text-xs)/1.4 var(--font-data)', color: 'var(--text-1)' }}>
                        {fmtInt(b.n, locale)}
                      </span>
                      <span style={{ font: '400 var(--text-2xs)/1.4 var(--font-data)', color: 'var(--text-3)' }}>
                        {fmtPercent(b.sharePct, locale, 0)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelLabel>{m.metric.chartTitle}</PanelLabel>
          <BarChart
            data={values}
            labels={xLabels}
            color={color}
            height={180}
            ariaLabel={`${label} — ${m.metric.chartTitle}`}
            noDataLabel={m.common.noData}
            format={(v) => writeOcc(v) ?? ABSENT}
          />
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {m.metric.timelineNote}
          </p>
        </Panel>
        {sourcesPanel}
        <Panel>
          <PanelLabel>{m.metric.timelineTitle}</PanelLabel>
          {occRows.length === 0 ? (
            <EmptyState
              icon="event_busy"
              title={m.metric.noData}
              hint={m.metric.noDataHint}
              action={allPeriodAction}
            />
          ) : (
            <DataTable columns={occColumns} rows={occRows} rowKey={(r) => r.key} dense />
          )}
        </Panel>
      </div>
    );
  }

  // --- chartable types -------------------------------------------------------
  const [stats, buckets, samples] = await Promise.all([
    metricWindowStats(ctx, hk, range, prevRange, elapsed),
    granularity === 'day'
      ? Promise.resolve(null)
      : exploreChart(ctx, [hk], range, prevRange, elapsed),
    metricSamples(ctx, hk, range),
  ]);

  // One writer for the whole page, built on the largest CANONICAL magnitude it
  // will print, so every figure carries the same precision.
  const writer = metricWriter(
    type.aggregation,
    type.canonicalUnit,
    Math.max(
      1,
      ...stats.values.filter((v): v is number => v !== null).map(Math.abs),
      Math.abs(stats.current ?? 0),
      Math.abs(stats.high?.value ?? 0)
    ),
    locale
  );
  const convert = (v: number | null): number | null => (v === null ? null : writer.convert(v));
  const dayValues = stats.values.map(convert);
  const prevValues = stats.previousValues.map(convert);
  const bucketValues = buckets?.series[0]?.values.map(convert) ?? null;
  const chartValues = bucketValues ?? dayValues;

  const empty = stats.daysMeasured === 0;
  // Bars are the honest rendering of a daily cumulative, but only while a bar
  // is wider than the gap next to it. Past that the same values read as a
  // curve, and the note below the chart says so rather than pretending.
  const asBars = cumulative && granularity === 'day' && chartValues.length <= MAX_BARS;
  const plotted = asBars ? chartValues : downsample(chartValues, MAX_CHART_POINTS);
  const plottedPrev = downsample(prevValues, MAX_CHART_POINTS);
  const rolling = asBars ? undefined : rollingWindow(plotted.length);
  // The area fill closes each CONTINUOUS run of the curve down to the axis, so
  // on a sparse series (a weight every few days) it paints one thin vertical
  // sliver per measure and the chart reads as a spiky signal it is not. Filled
  // only where the series is actually continuous.
  const dense = stats.daysTotal > 0 && stats.daysMeasured / stats.daysTotal >= 0.6;

  const xLabels =
    buckets && buckets.buckets
      ? bucketAxisLabels(buckets.buckets, granularity, locale, ctx.timezone)
      : dayAxisLabels(
          stats.days,
          locale,
          5,
          stats.days.length > 366 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }
        );

  const trend = trendProps(display.quality);
  // What the headline figure IS, per the declared aggregation: a total for a
  // cumulative, the last reading for a state that persists between
  // measurements, a mean otherwise (db/taxonomy.md).
  const primaryLabel = cumulative
    ? m.metric.total
    : type.aggregation === 'latest'
      ? m.metric.latestValue
      : m.metric.mean;
  const heatmap =
    cumulative && stats.daysTotal >= HEATMAP_MIN_DAYS && stats.daysTotal <= HEATMAP_MAX_DAYS
      ? buildHeatmap(stats.days, stats.values, locale, writer.write, m)
      : null;

  interface SampleRowView extends Record<string, unknown> {
    key: string;
    when: string;
    value: string | null;
    source: string;
    minuteChannel: boolean;
  }
  const sampleRows: SampleRowView[] = samples.map((s, i) => ({
    key: `${s.ts.toISOString()}-${i}`,
    when: fmtDateTime(s.ts, locale, ctx.timezone, true),
    value: writer.write(s.value),
    source: s.sourceName,
    minuteChannel: s.minuteChannel,
  }));
  const sampleColumns: Array<Column<SampleRowView>> = [
    { key: 'when', label: m.metric.colTime, mono: true },
    { key: 'value', label: m.metric.colValue, align: 'right', mono: true },
    {
      key: 'source',
      label: m.metric.colSource,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <SourceBadge name={row.source} />
          {row.minuteChannel && <Badge tone="neutral">{m.metric.minuteChannelBadge}</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {header}
      {scrubber}

      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <StatTile
            label={primaryLabel}
            value={writer.write(stats.current)}
            color={color}
            sub={
              <TrendChip
                deltaPct={stats.deltaPct}
                invert={trend.invert}
                neutral={trend.neutral}
                label={m.metric.vsPrevPeriod}
                locale={locale}
              />
            }
          />
          <StatTile
            label={cumulative ? m.metric.lowestDay : m.metric.min}
            value={stats.low === null ? null : writer.write(stats.low.value)}
            sub={
              stats.low === null ? undefined : (
                <ExtremeSub extreme={stats.low} locale={locale} timeZone={ctx.timezone} m={m} />
              )
            }
          />
          <StatTile
            label={cumulative ? m.metric.highestDay : m.metric.max}
            value={stats.high === null ? null : writer.write(stats.high.value)}
            sub={
              stats.high === null ? undefined : (
                <ExtremeSub extreme={stats.high} locale={locale} timeZone={ctx.timezone} m={m} />
              )
            }
          />
          <StatTile label={m.metric.samples} value={empty ? null : fmtInt(stats.samples, locale)} />
          <StatTile
            label={m.metric.daysMeasured}
            value={m.metric.coverage(fmtInt(stats.daysMeasured, locale), fmtInt(stats.daysTotal, locale))}
          />
        </div>
        {display.quality === 'neutral' && (
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {m.metric.neutralTrendHint}
          </p>
        )}
      </Panel>

      <Panel>
        <PanelLabel
          trailing={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="hy-label">{m.metric.granularity}</span>
              <Badge tone="neutral">{m.explore.granularities[granularity] ?? granularity}</Badge>
              <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)' }}>
                {m.metric.granularityAuto}
              </span>
            </span>
          }
        >
          {m.metric.chartTitle}
        </PanelLabel>
        {empty ? (
          <EmptyState
            icon="query_stats"
            title={m.metric.noData}
            hint={m.metric.noDataHint}
            action={allPeriodAction}
          />
        ) : asBars ? (
          <BarChart
            data={plotted}
            labels={xLabels}
            color={color}
            height={200}
            ariaLabel={`${label} — ${m.metric.chartTitle}`}
            noDataLabel={m.common.noData}
            format={(v) => writer.writeDisplay(v) ?? ABSENT}
          />
        ) : (
          <LineChart
            height={220}
            ariaLabel={`${label} — ${m.metric.chartTitle}`}
            emptyLabel={m.common.noDataOnPeriod}
            yFormat={(v, digits) => fmtNumber(v, locale, digits)}
            xLabels={xLabels}
            series={[
              {
                data: plotted,
                color,
                label: compare && granularity === 'day' ? m.dash.currentPeriod : undefined,
                rolling,
                area: dense,
              },
              ...(compare && granularity === 'day' && prevValues.some((v) => v !== null)
                ? [
                    {
                      data: plottedPrev,
                      color,
                      label: m.metric.vsPrevPeriod,
                      rolling,
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {!empty && (
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {asBars
              ? m.metric.barsNote
              : cumulative && granularity === 'day'
                ? m.metric.wideNote(stats.daysTotal)
                : rolling === undefined
                  ? m.metric.barsNote
                  : granularity === 'day'
                    ? m.metric.curveNote(rolling)
                    // At hour or minute grain the smoothing window is a number
                    // of BUCKETS, not of days: calling it days would be wrong
                    // by three orders of magnitude.
                    : m.metric.curveNoteBuckets(rolling)}
          </p>
        )}
      </Panel>

      {heatmap && (
        <Panel style={{ minWidth: 0 }}>
          <PanelLabel>{m.metric.heatmapTitle}</PanelLabel>
          <div className="hy-scrollx" style={{ overflowX: 'auto' }}>
            <CalendarHeatmap
              values={heatmap.values}
              titles={heatmap.titles}
              color={color}
              dayLabels={m.dash.dayInitials}
              ariaLabel={`${label} — ${m.metric.heatmapTitle}`}
            />
          </div>
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {m.metric.heatmapNote}
          </p>
        </Panel>
      )}

      {sourcesPanel}

      <Panel>
        <PanelLabel>{m.metric.samplesTitle}</PanelLabel>
        {sampleRows.length === 0 ? (
          <p style={{ font: 'italic 400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)', margin: 0 }}>
            {m.metric.samplesEmpty}
          </p>
        ) : (
          <>
            <DataTable columns={sampleColumns} rows={sampleRows} rowKey={(r) => r.key} dense />
            <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
              {m.metric.samplesNote}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * Calendar grid for a daily cumulative. The three states of the heatmap are
 * kept distinct: null (no data at all) is not 0 (data present, nothing
 * counted). Leading days are padded to the Monday of the first week so the
 * seven rows line up with the day initials.
 */
function buildHeatmap(
  days: string[],
  values: Array<number | null>,
  locale: Locale,
  withUnit: (v: number | null) => string | null,
  m: Messages
): { values: Array<number | null>; titles: string[] } {
  const first = days[0];
  if (!first) return { values: [], titles: [] };
  const pad = Math.round(
    (Date.parse(`${first}T00:00:00Z`) - Date.parse(`${mondayOf(first)}T00:00:00Z`)) / 86_400_000
  );
  const cells: Array<number | null> = Array.from({ length: pad }, () => null);
  const titles: string[] = Array.from({ length: pad }, () => '');
  days.forEach((day, i) => {
    const v = values[i];
    cells.push(v);
    titles.push(v === null ? `${fmtDay(day, locale)} · ${m.common.noData}` : `${fmtDay(day, locale)} · ${withUnit(v)}`);
  });
  while (cells.length % 7 !== 0) {
    cells.push(null);
    titles.push('');
  }
  return { values: cells, titles };
}
