// Dashboard (design reference: design/ui_kits/app/Dashboard.jsx).
// Sport + sleep MVP: six metric cards with sparkline and trend, daily heart
// rate chart (7-day rolling mean, dashed same-color comparison), today
// panel (gauge against the 90-day mean: a reference, never a goal), weekly
// training volume, 52-week regularity heatmap (null and 0 are different
// facts), recent activity timeline. The whole temporal state lives in the URL.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { TimelinePanel, TimelineSkeleton, TIMELINE_LOOKBACK_DAYS } from './timeline-panel';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { Gauge } from '@/components/charts/Gauge';
import { BarChart } from '@/components/charts/BarChart';
import { LineChart } from '@/components/charts/LineChart';
import { MetricCard } from '@/components/data/MetricCard';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { fmtDay, fmtHoursMinutes, fmtInt, fmtNumber, kjToKcal } from '@/lib/format';
import { getMessages, resolveLocale, type Locale } from '@/lib/i18n';
import { dataColor, type DataFamily } from '@/lib/metrics';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import { allTimeDailySeries, dailySeries, type DailyPoint } from '@/lib/queries/series';
import { seriesWithTrend, type Trend } from '@/lib/queries/trends';
import { sleepNights, sleepTrend } from '@/lib/queries/sleep';
import { dataTotals } from '@/lib/queries/sync';
import {
  addDays,
  comparisonRange,
  daysBetween,
  elapsedDays,
  todayInZone,
  type DayRange,
} from '@/lib/queries/time';
import { parseTimeParams, type TimeSearchParams } from '@/lib/queries/time-params';
import {
  monthlyTrainingSilhouette,
  weeklyVolume,
  workoutMinutesPerDay,
  workoutSummary,
} from '@/lib/queries/workouts';

export const metadata: Metadata = { title: 'Dashboard · Hygie' };
export const dynamic = 'force-dynamic';

const HK = {
  hr: 'HKQuantityTypeIdentifierHeartRate',
  restingHr: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  energy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  steps: 'HKQuantityTypeIdentifierStepCount',
  distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
};

function mean(points: DailyPoint[]): number | null {
  const vs = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vs.length === 0) return null;
  return vs.reduce((a, b) => a + b, 0) / vs.length;
}

/** Bucket-mean downsampling for sparklines and the all-time chart. */
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

function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function isoWeek(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

interface CardSpec {
  hk: string;
  icon: string;
  label: string;
  family: DataFamily;
  invert?: boolean;
  unit?: string;
  fmt: (v: number, locale: Locale) => string;
}

async function metricCardData(
  ctx: SubjectContext,
  spec: CardSpec,
  range: DayRange,
  preset: ReturnType<typeof parseTimeParams>['preset'],
  isAll: boolean,
  firstDay: string | null
): Promise<{ value: number | null; deltaPct: number | null; invertedTrend: boolean; points: Array<number | null> }> {
  if (isAll && firstDay) {
    const s = await allTimeDailySeries(ctx, spec.hk, firstDay);
    return {
      value: mean(s.points),
      deltaPct: null,
      invertedTrend: spec.invert ?? false,
      points: downsample(s.points.map((p) => p.value), 120),
    };
  }
  const r = await seriesWithTrend(ctx, spec.hk, range, preset);
  return {
    value: mean(r.points),
    deltaPct: r.trend.deltaPct,
    invertedTrend: spec.invert ?? false,
    points: downsample(r.points.map((p) => p.value), 120),
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<TimeSearchParams>;
}) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const totals = await dataTotals(ctx);
  const sp = await searchParams;
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);
  const isAll = preset === 'all';
  const elapsed = elapsedDays(range, today);
  const prevRange = comparisonRange(preset, range, elapsed);

  const cardSpecs: CardSpec[] = [
    { hk: HK.restingHr, icon: 'favorite', label: m.dash.restingHr, family: 'heart', invert: true, unit: 'bpm', fmt: (v, l) => fmtInt(v, l) },
    { hk: HK.hrv, icon: 'ecg', label: m.dash.hrv, family: 'heart', unit: 'ms', fmt: (v, l) => fmtInt(v, l) },
    { hk: HK.energy, icon: 'local_fire_department', label: m.dash.activeEnergyPerDay, family: 'energy', unit: 'kcal', fmt: (v, l) => fmtInt(kjToKcal(v), l) },
    { hk: HK.steps, icon: 'steps', label: m.dash.stepsPerDay, family: 'activity', fmt: (v, l) => fmtInt(v, l) },
    { hk: HK.distance, icon: 'directions_walk', label: m.dash.distancePerDay, family: 'activity', unit: 'km', fmt: (v, l) => fmtNumber(v, l, 1) },
  ];

  const todayRange: DayRange = { fromDay: today, toDayExcl: addDays(today, 1) };
  const last90: DayRange = { fromDay: addDays(today, -90), toDayExcl: today };
  const heatEndExcl = addDays(today, 1);
  const heatStart = addDays(mondayOf(today), -51 * 7);
  const heatRange: DayRange = { fromDay: heatStart, toDayExcl: heatEndExcl };
  const prev52: DayRange = { fromDay: addDays(heatStart, -364), toDayExcl: heatStart };
  const volRange: DayRange = { fromDay: addDays(mondayOf(today), -49), toDayExcl: heatEndExcl };

  const [
    cards,
    nights,
    nightsTrend,
    hrCur,
    hrPrev,
    todayEnergy,
    todaySteps,
    todayDistance,
    energy90,
    weeks,
    heatSteps,
    heatWorkouts,
    heatSummary,
    heatSummaryPrev,
    silhouette,
  ] = await Promise.all([
    Promise.all(cardSpecs.map((spec) => metricCardData(ctx, spec, range, preset, isAll, totals.firstDay))),
    sleepNights(ctx, range),
    isAll ? Promise.resolve(null) : sleepTrend(ctx, range, prevRange),
    isAll && totals.firstDay
      ? allTimeDailySeries(ctx, HK.hr, totals.firstDay)
      : dailySeries(ctx, HK.hr, range),
    compare && !isAll ? dailySeries(ctx, HK.hr, prevRange) : Promise.resolve(null),
    dailySeries(ctx, HK.energy, todayRange),
    dailySeries(ctx, HK.steps, todayRange),
    dailySeries(ctx, HK.distance, todayRange),
    dailySeries(ctx, HK.energy, last90),
    weeklyVolume(ctx, volRange),
    dailySeries(ctx, HK.steps, heatRange),
    workoutMinutesPerDay(ctx, heatRange),
    workoutSummary(ctx, heatRange),
    workoutSummary(ctx, prev52),
    monthlyTrainingSilhouette(ctx),
  ]);

  // --- sleep card -------------------------------------------------------------
  const nightsByDate = new Map(nights.map((n) => [n.nightDate, n.asleepS]));
  const sleepDays: string[] = [];
  for (let d = range.fromDay; d < range.toDayExcl; d = addDays(d, 1)) sleepDays.push(d);
  const sleepPoints = downsample(sleepDays.map((d) => nightsByDate.get(d) ?? null), 120);
  const asleepValues = nights.map((n) => n.asleepS).filter((v): v is number => v !== null);
  const sleepMean = asleepValues.length > 0 ? asleepValues.reduce((a, b) => a + b, 0) / asleepValues.length : null;

  // --- HR chart ---------------------------------------------------------------
  const hrValues = hrCur.points.map((p) => p.value);
  const chartLen = hrValues.length;
  const hrDown = downsample(hrValues, 366);
  const rollingWindow = chartLen > 800 ? 4 : Math.min(7, Math.max(2, Math.floor(chartLen / 4)));
  const hrTrend: Trend | null =
    hrPrev !== null
      ? (() => {
          const cur = mean(hrCur.points.slice(0, elapsed));
          const prev = mean(hrPrev.points);
          return cur !== null && prev !== null && prev !== 0
            ? { current: cur, previous: prev, deltaPct: ((cur - prev) / prev) * 100, currentDays: elapsed, previousDays: hrPrev.points.length }
            : null;
        })()
      : null;
  const chartXLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const idx = Math.min(chartLen - 1, Math.round(f * (chartLen - 1)));
    const day = hrCur.points[idx]?.day;
    return day ? fmtDay(day, locale, chartLen > 366 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }) : '';
  });

  // --- today panel -------------------------------------------------------------
  const todayKj = todayEnergy.points[0]?.value ?? null;
  const mean90Kj = mean(energy90.points);
  const todayKcal = kjToKcal(todayKj);
  const mean90Kcal = kjToKcal(mean90Kj);

  // --- weekly volume: a week without sessions is a real 0 (training is
  // observed through workouts themselves), not a data gap.
  const weekBars = weeks.map((w) => (w.distanceM ?? 0) / 1000);
  const weekLabels = weeks.map((w) => `W${isoWeek(w.weekStart)}`);

  // --- heatmap -----------------------------------------------------------------
  const heatDays: string[] = [];
  for (let d = heatStart; d < heatEndExcl; d = addDays(d, 1)) heatDays.push(d);
  const stepsByDay = new Map(heatSteps.points.map((p) => [p.day, p.value]));
  const heatValues = heatDays.map((d) => {
    const workoutMin = heatWorkouts.get(d);
    if (workoutMin !== undefined) return workoutMin;
    return stepsByDay.get(d) !== null && stepsByDay.get(d) !== undefined ? 0 : null;
  });
  // Pad the trailing partial week so the grid stays 7-row aligned.
  while (heatValues.length % 7 !== 0) {
    heatValues.push(null);
    heatDays.push('');
  }
  const heatTitles = heatDays.map((d, i) => {
    if (!d) return '';
    const v = heatValues[i];
    const label = fmtDay(d, locale);
    if (v === null) return `${label} · ${m.common.noData}`;
    return v === 0 ? label : `${label} · ${fmtInt(v, locale)} min`;
  });
  const heatDelta =
    heatSummaryPrev.count > 0 ? ((heatSummary.count - heatSummaryPrev.count) / heatSummaryPrev.count) * 100 : null;

  const gridPanel = { display: 'grid', gap: 12 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.dash.title}</h1>
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

      <div style={{ ...gridPanel, gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 10 }}>
        {cardSpecs.map((spec, i) => {
          const c = cards[i];
          return (
            <MetricCard
              key={spec.hk}
              icon={spec.icon}
              label={spec.label}
              value={c.value === null ? null : spec.fmt(c.value, locale)}
              unit={spec.unit}
              deltaPct={c.deltaPct}
              invert={c.invertedTrend}
              trendTitle={m.dash.vsPrevPeriod}
              points={c.points}
              color={dataColor(spec.family)}
              locale={locale}
              emptyLabel={m.common.noDataOnPeriod}
            />
          );
        })}
        <MetricCard
          icon="bedtime"
          label={m.dash.sleepAvg}
          value={sleepMean === null ? null : fmtHoursMinutes(sleepMean)}
          deltaPct={nightsTrend?.deltaPct ?? null}
          trendTitle={m.dash.vsPrevPeriod}
          points={sleepPoints}
          color={dataColor('sleep')}
          locale={locale}
          emptyLabel={m.common.noDataOnPeriod}
        />
      </div>

      <div style={{ ...gridPanel, gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <Panel>
          <PanelLabel
            trailing={
              hrTrend ? (
                <TrendChip deltaPct={hrTrend.deltaPct} invert label={m.dash.avgOnPeriod} locale={locale} />
              ) : undefined
            }
          >
            {m.dash.hrChartTitle}
          </PanelLabel>
          <LineChart
            height={190}
            ariaLabel={m.dash.hrChartTitle}
            emptyLabel={m.common.noDataOnPeriod}
            xLabels={chartXLabels}
            series={[
              {
                data: hrDown,
                color: 'var(--data-heart)',
                label: compare && hrPrev ? m.dash.currentPeriod : undefined,
                rolling: rollingWindow,
                area: true,
              },
              ...(hrPrev
                ? [
                    {
                      data: downsample(hrPrev.points.map((p) => p.value), 366),
                      color: 'var(--data-heart)',
                      label: m.dash.vsPrevPeriod,
                      rolling: rollingWindow,
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Panel>
            <PanelLabel>{m.dash.todayTitle}</PanelLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Gauge
                value={todayKcal}
                max={mean90Kcal ?? 1}
                display={todayKcal === null ? '' : fmtInt(todayKcal, locale)}
                unit="kcal"
                label={m.dash.energy}
                color={dataColor('energy')}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <StatTile
                  label={m.dash.steps}
                  value={todaySteps.points[0]?.value === null ? null : fmtInt(todaySteps.points[0]?.value ?? null, locale)}
                />
                <StatTile
                  label={m.dash.distance}
                  value={
                    todayDistance.points[0]?.value === null || todayDistance.points[0] === undefined
                      ? null
                      : fmtNumber(todayDistance.points[0].value, locale, 1)
                  }
                  unit="km"
                />
              </div>
            </div>
            {mean90Kcal !== null && (
              <p style={{ font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)', margin: '8px 0 0' }}>
                {m.dash.vsAvg90d(`${fmtInt(mean90Kcal, locale)} kcal`)}
              </p>
            )}
          </Panel>

          <Panel>
            <PanelLabel>{m.dash.weeklyVolumeTitle}</PanelLabel>
            <BarChart
              data={weekBars}
              labels={weekLabels}
              color={dataColor('distance')}
              height={86}
              ariaLabel={m.dash.weeklyVolumeTitle}
              noDataLabel={m.common.noData}
              format={(v) => fmtNumber(v, locale, 1)}
            />
          </Panel>
        </div>
      </div>

      {/* alignItems start: each panel keeps its own height, the heatmap is
          not stretched to the length of the timeline next to it. */}
      <div style={{ ...gridPanel, gridTemplateColumns: 'minmax(0, auto) minmax(320px, 1fr)', alignItems: 'start' }}>
        <Panel style={{ overflowX: 'auto', minWidth: 0 }}>
          <PanelLabel
            trailing={
              heatDelta !== null ? (
                <TrendChip deltaPct={heatDelta} label={m.dash.vsPrevPeriod} locale={locale} />
              ) : undefined
            }
          >
            {m.dash.regularityTitle}
          </PanelLabel>
          <CalendarHeatmap
            values={heatValues}
            titles={heatTitles}
            color={dataColor('activity')}
            dayLabels={m.dash.dayInitials}
            ariaLabel={m.dash.regularityTitle}
          />
          <div style={{ display: 'flex', gap: 28, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <StatTile label={m.dash.sessionsTile} value={fmtInt(heatSummary.count, locale)} />
            <StatTile label={m.dash.hoursTile} value={fmtNumber(heatSummary.totalDurationS / 3600, locale, 1)} />
            <StatTile
              label={m.dash.kmTile}
              value={heatSummary.totalDistanceM === null ? null : fmtInt(heatSummary.totalDistanceM / 1000, locale)}
            />
          </div>
        </Panel>

        <Panel padding="8px 6px" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '4px 8px 0' }}>
            <PanelLabel
              trailing={
                <Link
                  href="/sport"
                  className="hy-ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px',
                    borderRadius: 'var(--r-sm)',
                    textDecoration: 'none',
                    color: 'var(--text-2)',
                    font: '500 var(--text-xs)/1 var(--font-ui)',
                  }}
                >
                  {m.dash.seeAll}
                  <Icon name="arrow_forward" size={13} />
                </Link>
              }
            >
              {m.timeline.title}
              <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                {m.timeline.window(TIMELINE_LOOKBACK_DAYS)}
              </span>
            </PanelLabel>
          </div>
          <Suspense fallback={<TimelineSkeleton label={m.timeline.loading} />}>
            <TimelinePanel ctx={ctx} range={range} today={today} />
          </Suspense>
        </Panel>
      </div>
    </div>
  );
}
