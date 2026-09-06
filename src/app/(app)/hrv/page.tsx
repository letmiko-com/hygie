// Heart rate variability from the beat-to-beat series (migration 0007).
//
// /markers already draws Apple's HeartRateVariabilitySDNN, one number per
// measurement computed by the watch over 60 s. This screen reads the material
// under it: every interval between two beats. That is what makes RMSSD and
// pNN50 possible at all, and what lets one measurement be read as a curve
// instead of a figure.
//
// No target zone, no "recovery" verdict: the window states what was measured
// and compares it with the previous window, nothing more.
import type { Metadata } from 'next';
import { LineChart } from '@/components/charts/LineChart';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { StatTile } from '@/components/data/StatTile';
import { TimeNav } from '@/components/time/TimeNav';
import Link from '@/components/ui/Link';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime, fmtDuration, fmtInt } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { hrvDailySeries, hrvTotals, listHeartbeatSeries, type HeartbeatSeriesItem } from '@/lib/queries/hrv';
import { todayInZone } from '@/lib/queries/time';
import { parseTimeParams, type TimeSearchParams } from '@/lib/queries/time-params';
import { dayAxisLabels } from '@/lib/time-format';

export const metadata: Metadata = { title: 'Variabilité · Hygie' };
export const dynamic = 'force-dynamic';

const MAX_LISTED = 200;

function mean(values: Array<number | null>): number | null {
  const vs = values.filter((v): v is number => v !== null);
  return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0) / vs.length;
}

export default async function HrvPage({ searchParams }: { searchParams: Promise<TimeSearchParams> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const sp = await searchParams;
  const today = todayInZone(ctx.timezone);
  const totals = await hrvTotals(ctx);
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);

  const [days, series] = await Promise.all([
    hrvDailySeries(ctx, range),
    listHeartbeatSeries(ctx, range, MAX_LISTED),
  ]);

  // The chart is indexed by day of the window, so a day without a series is a
  // hole rather than a zero.
  const dayKeys: string[] = [];
  for (let d = new Date(`${range.fromDay}T00:00:00Z`); ; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    if (key >= range.toDayExcl) break;
    dayKeys.push(key);
  }
  const byDay = new Map(days.map((d) => [d.day, d]));
  const rmssd = dayKeys.map((k) => byDay.get(k)?.rmssdMs ?? null);
  const sdnn = dayKeys.map((k) => byDay.get(k)?.sdnnMs ?? null);

  // The list is capped, the window is not: the tile must count what the window
  // holds, or "200" would be read as a measurement on a three-year view.
  const windowSeries = days.reduce((a, d) => a + d.seriesCount, 0);
  const meanHr = mean(days.map((d) => d.meanHrBpm));
  const fmtMean = (v: number | null) => (v === null ? null : fmtInt(v, locale));
  const hasHistory = totals.series > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>{m.hrv.title}</h1>
          <span style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{m.hrv.subtitle}</span>
        </div>
        {hasHistory && (
          <TimeNav
            preset={preset}
            range={range}
            compare={compare}
            firstDataDay={totals.firstDay}
            today={today}
            locale={locale}
            labels={m.timenav}
          />
        )}
        <p style={{ margin: 0, maxWidth: 760, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.hrv.intro}
        </p>
      </header>

      {!hasHistory ? (
        <Panel>
          <EmptyState icon="monitor_heart" title={m.hrv.emptyAllTime} hint={m.hrv.emptyAllTimeHint} />
        </Panel>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {/* A window with no series hands StatTile a null, which renders the
                absence glyph: a mean of nothing is not zero. */}
            <StatTile label={m.hrv.rmssd} value={fmtMean(mean(rmssd))} unit="ms" />
            <StatTile label={m.hrv.sdnn} value={fmtMean(mean(sdnn))} unit="ms" />
            <StatTile label={m.hrv.meanHr} value={fmtMean(meanHr)} unit="bpm" />
            <StatTile label={m.hrv.series} value={fmtInt(windowSeries, locale)} />
          </div>

          <Panel>
            <PanelLabel>{m.hrv.trend}</PanelLabel>
            <LineChart
              series={[
                { data: rmssd, color: 'var(--data-heart)', label: m.hrv.rmssd, connect: true },
                { data: sdnn, color: 'var(--data-sleep)', label: m.hrv.sdnn, connect: true, dashed: true },
              ]}
              xLabels={dayAxisLabels(
                dayKeys,
                locale,
                4,
                // Past a year, a bare "25 oct." on a three-year axis says
                // nothing: the year is the part that carries the meaning.
                dayKeys.length > 366
                  ? { month: 'short', year: '2-digit' }
                  : { day: 'numeric', month: 'short' }
              )}
              ariaLabel={`${m.hrv.trend} — ${m.hrv.rmssd}, ${m.hrv.sdnn}`}
              emptyLabel={m.hrv.empty}
              yFormat={(v, digits) => `${v.toFixed(digits)} ms`}
            />
          </Panel>

          <Panel>
            <PanelLabel>
              {series.length < windowSeries
                ? m.hrv.seriesShown(series.length, windowSeries)
                : m.hrv.seriesCount(series.length)}
            </PanelLabel>
            {series.length === 0 ? (
              <EmptyState icon="monitor_heart" title={m.hrv.empty} hint={m.hrv.emptyHint} />
            ) : (
              <DataTable<HeartbeatSeriesItem & Record<string, unknown>>
                rows={series as Array<HeartbeatSeriesItem & Record<string, unknown>>}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'startTs',
                    label: m.hrv.series,
                    render: (r) => (
                      <Link
                        href={`/hrv/${r.id}`}
                        style={{ color: 'var(--accent-strong)', textDecoration: 'none', fontWeight: 500 }}
                      >
                        {fmtDateTime(r.startTs, locale, ctx.timezone, true)}
                      </Link>
                    ),
                  },
                  {
                    key: 'rmssdMs',
                    label: m.hrv.rmssd,
                    align: 'right',
                    mono: true,
                    render: (r) => (r.rmssdMs === null ? null : `${fmtInt(r.rmssdMs, locale)} ms`),
                  },
                  {
                    key: 'sdnnMs',
                    label: m.hrv.sdnn,
                    align: 'right',
                    mono: true,
                    render: (r) => (r.sdnnMs === null ? null : `${fmtInt(r.sdnnMs, locale)} ms`),
                  },
                  {
                    key: 'pnn50Pct',
                    label: m.hrv.pnn50,
                    align: 'right',
                    mono: true,
                    render: (r) => (r.pnn50Pct === null ? null : `${fmtInt(r.pnn50Pct, locale)} %`),
                  },
                  {
                    key: 'meanHrBpm',
                    label: m.hrv.meanHr,
                    align: 'right',
                    mono: true,
                    render: (r) => (r.meanHrBpm === null ? null : `${fmtInt(r.meanHrBpm, locale)} bpm`),
                  },
                  {
                    key: 'beatCount',
                    label: m.hrv.beatsLabel,
                    align: 'right',
                    mono: true,
                    render: (r) =>
                      r.gapCount > 0
                        ? `${fmtInt(r.beatCount, locale)} · ${m.hrv.gaps(r.gapCount)}`
                        : fmtInt(r.beatCount, locale),
                  },
                  {
                    key: 'durationS',
                    label: m.hrv.duration,
                    align: 'right',
                    mono: true,
                    render: (r) => (r.durationS === null ? null : fmtDuration(Math.round(r.durationS))),
                  },
                ]}
              />
            )}
          </Panel>

          <Panel>
            <PanelLabel>{m.hrv.aboutTitle}</PanelLabel>
            <p style={{ margin: 0, maxWidth: 760, font: '400 var(--text-sm)/1.5 var(--font-ui)', color: 'var(--text-3)' }}>
              {m.hrv.aboutBody}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
