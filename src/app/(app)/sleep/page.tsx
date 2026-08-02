// Sleep screen (design reference: design/ui_kits/app/Sleep.jsx). Nights come
// from the sleep query layer (wake-date convention, one winning source per
// night, HAE summaries over derived aggregation). A night without data is a
// dashed placeholder everywhere, never a zero. Stage detail bars only render
// for periods up to 100 days; longer windows keep the rolling-mean chart.
import type { Metadata } from 'next';
import { LineChart } from '@/components/charts/LineChart';
import { MetricCard } from '@/components/data/MetricCard';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { EmptyState } from '@/components/data/EmptyState';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { fmtDay, fmtHoursMinutes, fmtInt, fmtNumber } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { getSubjectContext } from '@/lib/queries/context';
import { sleepNights, type SleepNight } from '@/lib/queries/sleep';
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
import { monthlyTrainingSilhouette } from '@/lib/queries/workouts';

export const metadata: Metadata = { title: 'Sommeil · Hygie' };
export const dynamic = 'force-dynamic';

const SLEEP_COLOR = 'var(--data-sleep)';
const PHASES = [
  { key: 'deep', opacity: 1, color: SLEEP_COLOR },
  { key: 'core', opacity: 0.55, color: SLEEP_COLOR },
  { key: 'rem', opacity: 0.3, color: SLEEP_COLOR },
  { key: 'awake', opacity: 0.8, color: 'var(--warn)' },
] as const;
type PhaseKey = (typeof PHASES)[number]['key'];

interface NightView {
  deepH: number;
  coreH: number;
  remH: number;
  awakeH: number;
  totalH: number;
}

function toView(n: SleepNight): NightView | null {
  if (n.asleepS === null) return null;
  const deep = (n.deepS ?? 0) / 3600;
  const core = (n.coreS ?? 0) / 3600;
  const rem = (n.remS ?? 0) / 3600;
  const awake = (n.awakeS ?? 0) / 3600;
  return { deepH: deep, coreH: core, remH: rem, awakeH: awake, totalH: n.asleepS / 3600 };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pctDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Minutes since local noon: keeps bedtimes around midnight on one scale. */
function bedtimeMinutes(n: SleepNight, tz: string): number | null {
  if (!n.sleepStart) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  });
  const [h, m] = fmt.format(n.sleepStart).split(':').map(Number);
  const sinceMidnight = h * 60 + m;
  return sinceMidnight >= 720 ? sinceMidnight - 720 : sinceMidnight + 720;
}

interface Aggregates {
  durationH: number | null;
  deepH: number | null;
  /** Mean absolute deviation of bedtime, minutes. */
  bedtimeMadMin: number | null;
  /** Mean bedtime in minutes since local noon. */
  bedtimeMeanMin: number | null;
}

function aggregate(nights: SleepNight[], tz: string): Aggregates {
  const views = nights.map(toView).filter((v): v is NightView => v !== null);
  const bedtimes = nights.map((n) => bedtimeMinutes(n, tz)).filter((v): v is number => v !== null);
  const bedMean = mean(bedtimes);
  return {
    durationH: mean(views.map((v) => v.totalH)),
    deepH: mean(views.map((v) => v.deepH)),
    bedtimeMadMin:
      bedMean === null ? null : mean(bedtimes.map((b) => Math.abs(b - bedMean))),
    bedtimeMeanMin: bedMean,
  };
}

function fmtBedtime(minSinceNoon: number | null): string | null {
  if (minSinceNoon === null) return null;
  const sinceMidnight = (minSinceNoon + 720) % 1440;
  const h = Math.floor(sinceMidnight / 60);
  const m = Math.round(sinceMidnight % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function NightBars({
  days,
  byDate,
  locale,
  m,
}: {
  days: string[];
  byDate: Map<string, SleepNight>;
  locale: Locale;
  m: Messages;
}) {
  const views = days.map((d) => {
    const n = byDate.get(d);
    return n ? toView(n) : null;
  });
  const maxH = Math.max(9, ...views.filter((v): v is NightView => v !== null).map((v) => v.totalH + v.awakeH));
  return (
    <div>
      <div
        role="img"
        aria-label={m.sleep.nightsTitle}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: days.length > 45 ? 1 : 4,
          height: 170,
          borderBottom: '1px solid var(--border-strong)',
        }}
      >
        {views.map((v, i) =>
          v === null ? (
            <span
              key={i}
              title={`${fmtDay(days[i], locale)} · ${m.common.noData}`}
              style={{
                flex: 1,
                height: '40%',
                border: '1px dashed var(--border-strong)',
                borderBottom: 'none',
                borderRadius: '2px 2px 0 0',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <span
              key={i}
              title={`${fmtDay(days[i], locale)} · ${fmtHoursMinutes(v.totalH * 3600)}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%' }}
            >
              {PHASES.map((p) => {
                const hours =
                  p.key === 'deep' ? v.deepH : p.key === 'core' ? v.coreH : p.key === 'rem' ? v.remH : v.awakeH;
                return (
                  <span
                    key={p.key}
                    style={{
                      height: `${(hours / maxH) * 100}%`,
                      background: p.color,
                      opacity: p.opacity,
                      borderRadius: p.key === 'awake' ? '2px 2px 0 0' : 0,
                    }}
                  />
                );
              })}
            </span>
          )
        )}
      </div>
      <div
        className="tnum"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 5,
          font: '400 var(--text-2xs)/1 var(--font-data)',
          color: 'var(--chart-axis)',
        }}
      >
        <span>{fmtDay(days[0], locale, { day: 'numeric', month: 'short' })}</span>
        <span>{fmtDay(days[Math.floor(days.length / 2)], locale, { day: 'numeric', month: 'short' })}</span>
        <span>{fmtDay(days[days.length - 1], locale, { day: 'numeric', month: 'short' })}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {PHASES.map((p) => (
          <span
            key={p.key}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '400 var(--text-xs)/1 var(--font-ui)', color: 'var(--text-2)' }}
          >
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: p.color, opacity: p.opacity }} />
            {m.sleep.phases[p.key]}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '400 var(--text-xs)/1 var(--font-ui)', color: 'var(--text-3)', marginLeft: 'auto' }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, border: '1px dashed var(--border-strong)' }} />
          {m.sleep.noDataLegend}
        </span>
      </div>
    </div>
  );
}

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

export default async function SleepPage({
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
  const elapsed = elapsedDays(range, today);
  const prevRange = comparisonRange(preset, range, elapsed);
  const rangeDays = daysBetween(range.fromDay, range.toDayExcl);

  const [nights, prevNights, silhouette] = await Promise.all([
    sleepNights(ctx, range),
    sleepNights(ctx, prevRange),
    monthlyTrainingSilhouette(ctx),
  ]);

  const byDate = new Map(nights.map((n) => [n.nightDate, n]));
  const days: string[] = [];
  for (let d = range.fromDay; d < range.toDayExcl; d = addDays(d, 1)) days.push(d);

  const cur = aggregate(nights, ctx.timezone);
  const prev = aggregate(prevNights, ctx.timezone);

  const hoursPerDay = days.map((d) => {
    const n = byDate.get(d);
    return n && n.asleepS !== null ? n.asleepS / 3600 : null;
  });
  const deepPerDay = days.map((d) => {
    const n = byDate.get(d);
    return n && n.deepS !== null ? n.deepS / 3600 : null;
  });
  const madSpark = hoursPerDay; // sparkline shape: duration is the most readable proxy

  // Stage distribution over nights that carry stages.
  const views = nights.map(toView).filter((v): v is NightView => v !== null);
  const sums = { deep: 0, core: 0, rem: 0, awake: 0 };
  for (const v of views) {
    sums.deep += v.deepH;
    sums.core += v.coreH;
    sums.rem += v.remH;
    sums.awake += v.awakeH;
  }
  const grandTotal = sums.deep + sums.core + sums.rem + sums.awake;
  const distribution: Array<{ key: PhaseKey; pct: number }> = PHASES.map((p) => ({
    key: p.key,
    pct: grandTotal > 0 ? (sums[p.key] / grandTotal) * 100 : 0,
  }));

  const deepDelta = pctDelta(cur.deepH, prev.deepH);

  // Comparison series for the duration chart, aligned by index like the HR chart.
  const prevByDate = new Map(prevNights.map((n) => [n.nightDate, n]));
  const prevDays: string[] = [];
  for (let d = prevRange.fromDay; d < prevRange.toDayExcl; d = addDays(d, 1)) prevDays.push(d);
  const prevHours = prevDays.map((d) => {
    const n = prevByDate.get(d);
    return n && n.asleepS !== null ? n.asleepS / 3600 : null;
  });

  const chartXLabels = [0, 0.5, 1].map((f) => {
    const idx = Math.min(days.length - 1, Math.round(f * (days.length - 1)));
    return fmtDay(days[idx], locale, rangeDays > 366 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  });

  const measuredCount = views.length;
  const missingCount = Math.min(rangeDays, elapsed) - measuredCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.sleep.title}</h1>
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

      {nights.length === 0 ? (
        <Panel>
          <EmptyState icon="bedtime" title={m.sleep.empty} />
        </Panel>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 10 }}>
            <MetricCard
              icon="bedtime"
              label={m.sleep.avgDuration}
              value={cur.durationH === null ? null : fmtHoursMinutes(cur.durationH * 3600)}
              deltaPct={pctDelta(cur.durationH, prev.durationH)}
              trendTitle={m.dash.vsPrevPeriod}
              points={downsample(hoursPerDay, 120)}
              color={SLEEP_COLOR}
              locale={locale}
              emptyLabel={m.common.noDataOnPeriod}
            />
            <MetricCard
              icon="dark_mode"
              label={m.sleep.deepSleep}
              value={cur.deepH === null || cur.deepH === 0 ? null : fmtHoursMinutes(cur.deepH * 3600)}
              deltaPct={deepDelta}
              trendTitle={m.dash.vsPrevPeriod}
              points={downsample(deepPerDay, 120)}
              color={SLEEP_COLOR}
              locale={locale}
              emptyLabel={m.common.noDataOnPeriod}
            />
            <MetricCard
              icon="event_repeat"
              label={m.sleep.regularity}
              value={cur.bedtimeMadMin === null ? null : `±${fmtInt(cur.bedtimeMadMin, locale)}`}
              unit="min"
              deltaPct={pctDelta(cur.bedtimeMadMin, prev.bedtimeMadMin)}
              invert
              trendTitle={m.dash.vsPrevPeriod}
              points={downsample(madSpark, 120)}
              color={SLEEP_COLOR}
              locale={locale}
              emptyLabel={m.common.noDataOnPeriod}
            />
            <MetricCard
              icon="schedule"
              label={m.sleep.avgBedtime}
              value={fmtBedtime(cur.bedtimeMeanMin)}
              deltaPct={null}
              points={downsample(
                nights.map((n) => bedtimeMinutes(n, ctx.timezone)),
                120
              )}
              color={SLEEP_COLOR}
              locale={locale}
              emptyLabel={m.common.noDataOnPeriod}
            />
          </div>

          {rangeDays <= 100 ? (
            <Panel>
              <PanelLabel
                trailing={
                  deepDelta !== null ? (
                    <TrendChip deltaPct={deepDelta} label={m.sleep.deepVsPrev} locale={locale} />
                  ) : undefined
                }
              >
                {m.sleep.nightsTitle}
              </PanelLabel>
              <NightBars days={days} byDate={byDate} locale={locale} m={m} />
            </Panel>
          ) : (
            <p style={{ font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-3)', margin: 0 }}>
              {m.sleep.tooLongForBars}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)', gap: 12 }}>
            <Panel>
              <PanelLabel>{m.sleep.durationChart}</PanelLabel>
              <LineChart
                height={150}
                ariaLabel={m.sleep.durationChart}
                yFormat={(v) => fmtNumber(v, locale, 1)}
                xLabels={chartXLabels}
                series={[
                  {
                    data: downsample(hoursPerDay, 366),
                    color: SLEEP_COLOR,
                    label: compare ? m.dash.currentPeriod : undefined,
                    rolling: Math.min(7, Math.max(2, Math.floor(days.length / 4))),
                    area: true,
                  },
                  ...(compare
                    ? [
                        {
                          data: downsample(prevHours, 366),
                          color: SLEEP_COLOR,
                          label: m.dash.vsPrevPeriod,
                          rolling: Math.min(7, Math.max(2, Math.floor(days.length / 4))),
                          dashed: true,
                        },
                      ]
                    : []),
                ]}
              />
            </Panel>

            <Panel>
              <PanelLabel>{m.sleep.distributionTitle}</PanelLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {distribution.map((d) => {
                  const phase = PHASES.find((p) => p.key === d.key);
                  return (
                    <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--text-2)', width: 64, flex: 'none' }}>
                        {m.sleep.phases[d.key]}
                      </span>
                      <div style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${d.pct}%`,
                            height: '100%',
                            background: phase?.color,
                            opacity: phase?.opacity,
                          }}
                        />
                      </div>
                      <span className="tnum" style={{ font: '500 var(--text-sm)/1 var(--font-data)', width: 44, textAlign: 'right' }}>
                        {fmtInt(d.pct, locale)} %
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <StatTile
                  label={m.sleep.nightsMeasured}
                  value={`${fmtInt(measuredCount, locale)} / ${fmtInt(Math.min(rangeDays, elapsed), locale)}`}
                  sub={missingCount > 0 ? m.sleep.nightsWithout(missingCount) : undefined}
                />
                <StatTile label={m.sleep.segmentsTile} value={fmtInt(totals.sleepSegments, locale)} />
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
