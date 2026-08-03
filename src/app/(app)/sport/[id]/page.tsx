// Session detail (design reference: design/ui_kits/app/SessionDetail.jsx).
// Session heart rate comes from raw observations inside the workout window
// (per-source, largest series charted, others mentioned); pace/power series
// and km splits appear only when the data exists. Facts, never inventions:
// a missing distance reads "not measured", a missing elevation "no GPS".
import type { Metadata } from 'next';
import Link from 'next/link';
import { LineChart } from '@/components/charts/LineChart';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { SourceBadge } from '@/components/data/SourceBadge';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import {
  fmtDuration,
  fmtInt,
  fmtKcalFromKj,
  fmtKm,
  fmtNumber,
  fmtPace,
} from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { sportDisplay, sportLabel } from '@/lib/sports';
import { getSubjectContext } from '@/lib/queries/context';
import { addDays, dayInZone } from '@/lib/queries/time';
import {
  getWorkout,
  observationSamples,
  workoutHeartRate,
  workoutSplits,
  workoutSummary,
} from '@/lib/queries/workouts';

export const metadata: Metadata = { title: 'Séance · Hygie' };
export const dynamic = 'force-dynamic';

const PACE_SPORTS = new Set([
  'HKWorkoutActivityTypeRunning',
  'HKWorkoutActivityTypeWalking',
  'HKWorkoutActivityTypeHiking',
]);
const SPEED_SPORTS = new Set(['HKWorkoutActivityTypeCycling']);

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

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const { id } = await params;
  const workout = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkout(ctx, id) : null;
  if (!workout) {
    return (
      <Panel>
        <EmptyState
          icon="search_off"
          title={m.session.notFound}
          hint={m.session.notFoundHint}
          action={
            <Link href="/sport" className="hy-btn" style={{ color: 'var(--accent-strong)', font: '500 var(--text-sm)/1 var(--font-ui)' }}>
              {m.session.back}
            </Link>
          }
        />
      </Panel>
    );
  }

  const sport = sportDisplay(workout.activityType);
  const color = dataColor(sport.family);

  // The reference window is the 90 days BEFORE this session, in the subject's
  // zone: anchoring it on today compared an April session against July ones,
  // and a session alone in the window was compared against itself, which
  // printed an exact "0,0 %" instead of an absence. Its own day is excluded,
  // so the session can never enter its own average.
  const workoutDay = dayInZone(workout.startTs, ctx.timezone);
  const [hrSeries, splits, sameSport90] = await Promise.all([
    workoutHeartRate(ctx, workout.id),
    workoutSplits(ctx, workout.id),
    workoutSummary(ctx, { fromDay: addDays(workoutDay, -90), toDayExcl: workoutDay }, workout.activityType),
  ]);

  const isRun = workout.activityType === 'HKWorkoutActivityTypeRunning';
  const power = isRun
    ? await observationSamples(ctx, 'HKQuantityTypeIdentifierRunningPower', workout.startTs, workout.endTs)
    : [];

  const primaryHr = hrSeries[0] ?? null;
  const maxHr = primaryHr ? Math.max(...primaryHr.samples.map((s) => s.bpm)) : null;
  const hrValues = primaryHr ? downsample(primaryHr.samples.map((s) => s.bpm), 400) : [];
  const hrDelta =
    workout.avgHrBpm !== null && sameSport90.avgHrBpm !== null && sameSport90.avgHrBpm !== 0
      ? ((workout.avgHrBpm - sameSport90.avgHrBpm) / sameSport90.avgHrBpm) * 100
      : null;

  const km = workout.distanceM === null ? null : workout.distanceM / 1000;
  const paceSecPerKm = km !== null && km > 0 && PACE_SPORTS.has(workout.activityType) ? workout.durationS / km : null;
  const speedKmh =
    km !== null && workout.durationS > 0 && SPEED_SPORTS.has(workout.activityType)
      ? km / (workout.durationS / 3600)
      : null;

  const timeFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ctx.timezone,
  });
  const dateFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ctx.timezone,
  });
  const durationLabel = fmtDuration(workout.durationS);
  const midLabel = (f: number) =>
    fmtDuration(workout.durationS * f);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Link
          href="/sport"
          title={m.session.back}
          aria-label={m.session.back}
          className="hy-btn hy-ghost"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'var(--control-h-md)',
            height: 'var(--control-h-md)',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-1)',
          }}
        >
          <Icon name="arrow_back" size={17} />
        </Link>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 'var(--r-md)',
            background: `color-mix(in oklab, ${color} 13%, transparent)`,
          }}
        >
          <Icon name={sport.icon} size={20} color={color} />
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>
              {sportLabel(workout.activityType, locale)}
            </h1>
            {workout.isIndoor && <Badge tone="neutral">{m.session.indoor}</Badge>}
          </div>
          <div className="tnum" style={{ font: '400 var(--text-sm)/1.4 var(--font-data)', color: 'var(--text-3)' }}>
            {dateFmt.format(workout.startTs)} · {timeFmt.format(workout.startTs)} → {timeFmt.format(workout.endTs)}
          </div>
        </div>
        <SourceBadge name={workout.sourceName} />
      </header>

      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: '14px 20px' }}>
          <StatTile label={m.session.duration} value={durationLabel} />
          <StatTile
            label={m.session.distance}
            value={km === null ? null : fmtKm(workout.distanceM, locale, 2)}
            sub={km === null ? m.session.notMeasured : undefined}
          />
          {paceSecPerKm !== null && <StatTile label={m.session.pace} value={fmtPace(paceSecPerKm)} />}
          {speedKmh !== null && (
            <StatTile label={m.session.speed} value={fmtNumber(speedKmh, locale, 1)} unit="km/h" />
          )}
          <StatTile
            label={m.session.avgHr}
            value={workout.avgHrBpm === null ? null : fmtInt(workout.avgHrBpm, locale)}
            unit={workout.avgHrBpm === null ? undefined : 'bpm'}
            color="var(--data-heart)"
            sub={
              hrDelta === null ? undefined : (
                <TrendChip deltaPct={hrDelta} invert label={m.session.vs90d} locale={locale} />
              )
            }
          />
          <StatTile
            label={m.session.maxHr}
            value={maxHr === null ? null : fmtInt(maxHr, locale)}
            unit={maxHr === null ? undefined : 'bpm'}
            color="var(--data-heart)"
          />
          <StatTile
            label={m.session.energy}
            value={workout.energyKj === null ? null : fmtKcalFromKj(workout.energyKj, locale)}
          />
          <StatTile
            label={m.session.elevation}
            value={workout.elevationUpM === null ? null : `${fmtInt(workout.elevationUpM, locale)} m`}
            sub={workout.elevationUpM === null && !workout.hasRoute ? m.session.noGps : undefined}
          />
        </div>
      </Panel>

      <Panel>
        <PanelLabel
          trailing={
            hrSeries.length > 1 ? (
              <span style={{ font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
                {m.session.hrOtherSources(hrSeries.length - 1)}
              </span>
            ) : undefined
          }
        >
          {m.session.hrChart}
          {primaryHr && (
            <span style={{ marginLeft: 8, font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>
              {primaryHr.sourceName}
            </span>
          )}
        </PanelLabel>
        {hrValues.length > 1 ? (
          <LineChart
            height={150}
            ariaLabel={m.session.hrChart}
            yFormat={(v, digits) => fmtNumber(v, locale, digits)}
            series={[{ data: hrValues, color: 'var(--data-heart)', area: true }]}
            xLabels={[0, 0.25, 0.5, 0.75, 1].map((f) => (f === 1 ? durationLabel : midLabel(f)))}
          />
        ) : (
          <p style={{ font: 'italic 400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)', margin: 0 }}>
            {m.session.noHr}
          </p>
        )}
      </Panel>

      {(power.length > 1 || splits !== null) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: power.length > 1 && splits !== null ? '1fr 1fr' : '1fr',
            gap: 12,
          }}
        >
          {power.length > 1 && (
            <Panel>
              <PanelLabel>{m.session.powerChart}</PanelLabel>
              <LineChart
                height={110}
                ariaLabel={m.session.powerChart}
                yFormat={(v, digits) => fmtNumber(v, locale, digits)}
                series={[{ data: downsample(power.map((p) => p.value), 300), color: dataColor('power'), area: true }]}
                xLabels={['0:00', durationLabel]}
              />
            </Panel>
          )}
          {splits !== null && (
            <Panel padding="6px 10px 10px">
              <div style={{ padding: '8px 2px 0' }}>
                <PanelLabel>{m.session.splits}</PanelLabel>
              </div>
              <DataTable
                dense
                rowKey={(r) => String(r.km)}
                columns={[
                  { key: 'km', label: m.session.splitKm, mono: true, width: 50 },
                  {
                    key: 'time',
                    label: m.session.splitTime,
                    align: 'right',
                    mono: true,
                    render: (r) => fmtDuration(Number(r.durationS)),
                  },
                  {
                    key: 'pace',
                    label: m.session.splitPace,
                    align: 'right',
                    mono: true,
                    muted: true,
                    render: (r) => fmtPace(Number(r.durationS)),
                  },
                ]}
                rows={splits.map((s) => ({ km: s.km, durationS: s.durationS }))}
              />
            </Panel>
          )}
        </div>
      )}

      {workout.hasRoute && (
        <Panel style={{ minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
            {m.session.gpsPlaceholder}
          </span>
        </Panel>
      )}
    </div>
  );
}
