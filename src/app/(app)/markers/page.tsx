// Health markers (product phase 2, 2026-09-04: fitIQ's "Recovery" and "Health
// markers" read through the charter). The background measures a body shows at
// rest and during sleep: heart rate variability, resting heart rate, breathing,
// wrist temperature, aerobic capacity, body composition. Each marker is read
// over the window, compared with the previous window, and drawn. No composite
// score, no readiness index: an instrument states, it does not grade.
//
// Which markers appear depends on the subject's catalogue (types that hold at
// least one measure for them), so a subject without a scale never sees an
// empty weight panel, and a type promoted tomorrow with data shows up here by
// being added to MARKERS alone. Everything temporal lives in the URL.
import type { Metadata } from 'next';
import Link from '@/components/ui/Link';
import { LineChart } from '@/components/charts/LineChart';
import { EmptyState } from '@/components/data/EmptyState';
import { MetricCard } from '@/components/data/MetricCard';
import { TrendChip } from '@/components/data/TrendChip';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { downsample } from '@/lib/downsample';
import { bucketSpans, drillSet, drillZone, spanQuery } from '@/lib/drill';
import { displayUnit, fmtDay, magnitudeFormat } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor, metricFamily, metricHref, metricIcon, metricLabel, metricQuality } from '@/lib/metrics';
import { subjectCatalog, type CatalogEntry } from '@/lib/queries/catalog';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import { allTimeDailySeries, type DailyPoint } from '@/lib/queries/series';
import { seriesWithTrend } from '@/lib/queries/trends';
import { dataTotals } from '@/lib/queries/sync';
import { type DayRange, type Preset, todayInZone } from '@/lib/queries/time';
import { parseTimeParams, timeQuery, type TimeSearchParams } from '@/lib/queries/time-params';
import { monthlyTrainingSilhouette } from '@/lib/queries/workouts';
import { dayAxisLabels } from '@/lib/time-format';

export const metadata: Metadata = { title: 'Marqueurs · Hygie' };
export const dynamic = 'force-dynamic';

/** Reading order: heart, breath and temperature, capacity, body. */
const MARKERS = [
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  'HKQuantityTypeIdentifierRespiratoryRate',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierAppleSleepingWristTemperature',
  'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances',
  'HKQuantityTypeIdentifierVO2Max',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierBodyFatPercentage',
  'HKQuantityTypeIdentifierLeanBodyMass',
];
const MAX_CHART_POINTS = 366;
/** Below half the days measured, the curve joins samples instead of smoothing them. */
const SPARSE_RATIO = 0.5;

interface Marker {
  hk: string;
  entry: CatalogEntry;
  points: DailyPoint[];
  previousPoints: DailyPoint[] | null;
  /** Mean of the daily values on the window (every marker is a point measure). */
  mean: number | null;
  deltaPct: number | null;
  latest: { value: number; day: string } | null;
  measured: number;
}

function mean(points: DailyPoint[]): number | null {
  const vs = points.map((p) => p.value).filter((v): v is number => v !== null);
  return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0) / vs.length;
}

async function loadMarker(
  ctx: SubjectContext,
  entry: CatalogEntry,
  range: DayRange,
  preset: Preset | null,
  compare: boolean,
  allTimeFrom: string | null
): Promise<Marker> {
  const hk = entry.hkIdentifier as string;
  let points: DailyPoint[];
  let previousPoints: DailyPoint[] | null = null;
  let deltaPct: number | null = null;
  if (allTimeFrom) {
    // The whole history has no previous window to compare with.
    points = (await allTimeDailySeries(ctx, hk, allTimeFrom)).points;
  } else {
    const r = await seriesWithTrend(ctx, hk, range, preset);
    points = r.points;
    previousPoints = compare ? r.previousPoints : null;
    deltaPct = r.trend.deltaPct;
  }
  const measuredPoints = points.filter((p) => p.value !== null);
  const last = measuredPoints.at(-1);
  return {
    hk,
    entry,
    points,
    previousPoints,
    mean: mean(points),
    deltaPct,
    latest: last ? { value: last.value as number, day: last.day } : null,
    measured: measuredPoints.length,
  };
}

/** One chart panel per marker: trend, latest measure, curve, link to the type's page. */
function MarkerPanel({
  marker,
  compare,
  locale,
  m,
  windowQuery,
}: {
  marker: Marker;
  compare: boolean;
  locale: Locale;
  m: Messages;
  windowQuery: string;
}) {
  const { hk, entry, points, previousPoints } = marker;
  const label = metricLabel(hk, locale);
  const color = dataColor(metricFamily(hk));
  const quality = metricQuality(hk);
  const display = displayUnit(entry.unit);
  const all = [...points, ...(previousPoints ?? [])].map((p) => p.value).filter((v): v is number => v !== null);
  const magnitude = all.length === 0 ? 1 : Math.max(...all.map((v) => Math.abs(v)));
  const format = magnitudeFormat(Math.abs(display.convert(magnitude)), locale);
  const write = (v: number) => `${format(display.convert(v))}${display.unit ? ` ${display.unit}` : ''}`;

  const values = downsample(points.map((p) => (p.value === null ? null : display.convert(p.value))), MAX_CHART_POINTS);
  const sparse = points.length > 0 && marker.measured / points.length < SPARSE_RATIO;
  const n = values.length;
  const rolling = sparse || n < 8 ? undefined : n > 800 ? 4 : Math.min(7, Math.max(2, Math.floor(n / 4)));
  const days = points.map((p) => p.day);
  const xLabels = dayAxisLabels(
    days,
    locale,
    5,
    days.length > 366 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }
  );
  const drill = drillSet(
    bucketSpans(days, MAX_CHART_POINTS).map((s) => drillZone(s, metricHref(hk, spanQuery(s)), locale, m)),
    locale,
    m
  );
  const note = sparse ? m.markers.sparseNote : rolling ? m.markers.rollingNote(rolling) : null;

  return (
    <Panel>
      <PanelLabel
        trailing={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <TrendChip
              deltaPct={marker.deltaPct}
              invert={quality === 'lower-better'}
              neutral={quality === 'neutral'}
              label={m.dash.vsPrevPeriod}
              locale={locale}
            />
            <Link
              href={metricHref(hk, windowQuery)}
              className="hy-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 5px',
                borderRadius: 'var(--r-sm)',
                textDecoration: 'none',
                color: 'var(--text-3)',
                font: '500 var(--text-2xs)/1 var(--font-ui)',
              }}
            >
              {m.common.seeDetail}
              <Icon name="arrow_forward" size={12} />
            </Link>
          </span>
        }
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={metricIcon(hk)} size={14} color={color} />
          {label}
        </span>
      </PanelLabel>
      <LineChart
        height={170}
        ariaLabel={label}
        emptyLabel={m.common.noDataOnPeriod}
        yFormat={(v) => format(v)}
        xLabels={xLabels}
        drill={drill}
        series={[
          {
            data: values,
            color,
            label: compare && previousPoints ? m.dash.currentPeriod : undefined,
            rolling,
            area: !sparse,
            connect: sparse,
          },
          ...(previousPoints
            ? [
                {
                  data: downsample(
                    previousPoints.map((p) => (p.value === null ? null : display.convert(p.value))),
                    MAX_CHART_POINTS
                  ),
                  color,
                  label: m.dash.vsPrevPeriod,
                  rolling,
                  dashed: true,
                  connect: sparse,
                },
              ]
            : []),
        ]}
      />
      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          marginTop: 8,
          font: '400 var(--text-2xs)/1.4 var(--font-ui)',
          color: 'var(--text-3)',
        }}
      >
        <span className="tnum">{m.markers.measured(marker.measured, points.length)}</span>
        {marker.latest && (
          <span className="tnum">{m.markers.latest(write(marker.latest.value), fmtDay(marker.latest.day, locale))}</span>
        )}
        {note && <span>{note}</span>}
      </div>
    </Panel>
  );
}

export default async function MarkersPage({ searchParams }: { searchParams: Promise<TimeSearchParams> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const sp = await searchParams;
  const [totals, catalog, silhouette] = await Promise.all([
    dataTotals(ctx),
    subjectCatalog(ctx, today),
    monthlyTrainingSilhouette(ctx),
  ]);
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);
  const windowQuery = timeQuery(sp);
  const allTimeFrom = preset === 'all' && totals.firstDay ? totals.firstDay : null;

  // The catalogue only lists types holding data for this subject.
  const byHk = new Map(catalog.filter((c) => c.hkIdentifier !== null).map((c) => [c.hkIdentifier as string, c]));
  const entries = MARKERS.map((hk) => byHk.get(hk)).filter((c): c is CatalogEntry => c !== undefined);
  const markers = await Promise.all(entries.map((entry) => loadMarker(ctx, entry, range, preset, compare, allTimeFrom)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.markers.title}</h1>
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
        <p style={{ margin: 0, maxWidth: 760, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.markers.intro}
        </p>
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

      {markers.length === 0 ? (
        <Panel>
          <EmptyState icon="ecg" title={m.markers.empty} hint={m.markers.emptyHint} />
        </Panel>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 10 }}>
            {markers.map((marker) => {
              const display = displayUnit(marker.entry.unit);
              const quality = metricQuality(marker.hk);
              const magnitude = marker.mean === null ? 1 : Math.abs(display.convert(marker.mean));
              const format = magnitudeFormat(magnitude, locale);
              return (
                <MetricCard
                  key={marker.hk}
                  icon={metricIcon(marker.hk)}
                  label={metricLabel(marker.hk, locale)}
                  value={marker.mean === null ? null : format(display.convert(marker.mean))}
                  unit={display.unit ?? undefined}
                  deltaPct={marker.deltaPct}
                  invert={quality === 'lower-better'}
                  neutral={quality === 'neutral'}
                  trendTitle={m.dash.vsPrevPeriod}
                  points={downsample(
                    marker.points.map((p) => (p.value === null ? null : display.convert(p.value))),
                    120
                  )}
                  color={dataColor(metricFamily(marker.hk))}
                  locale={locale}
                  emptyLabel={m.common.noDataOnPeriod}
                  href={metricHref(marker.hk, windowQuery)}
                />
              );
            })}
          </div>
          <div className="hy-split" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 12 }}>
            {markers.map((marker) => (
              <MarkerPanel key={marker.hk} marker={marker} compare={compare} locale={locale} m={m} windowQuery={windowQuery} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
