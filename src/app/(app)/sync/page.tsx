// Sync status screen (design reference: design/ui_kits/app/Sync.jsx).
// Adapted to the real MVP data: the mock's "detected gaps" panel is replaced
// by the recent batches table (gap detection is post-MVP), and there is no
// "sync now" button (the companion app pushes; the server cannot trigger
// a sync).
import type { Metadata } from 'next';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { SourceBadge } from '@/components/data/SourceBadge';
import { StatTile } from '@/components/data/StatTile';
import { SyncBadge, type SyncState } from '@/components/data/SyncBadge';
import { TrendChip } from '@/components/data/TrendChip';
import { BarChart } from '@/components/charts/BarChart';
import {
  fmtBytes,
  fmtCompact,
  fmtDay,
  fmtInt,
  fmtNumber,
  fmtRelative,
} from '@/lib/format';
import { getMessages, resolveLocale, type Messages } from '@/lib/i18n';
import { dataColor, metricFamily, metricLabel } from '@/lib/metrics';
import { getSubjectContext } from '@/lib/queries/context';
import {
  dataTotals,
  ingestVolumesByDay,
  recentBatches,
  syncOverview,
  observationCount,
  topTypes,
  type BatchInfo,
} from '@/lib/queries/sync';
import { dayInZone } from '@/lib/queries/time';

export const metadata: Metadata = { title: 'Synchronisation · Hygie' };
export const dynamic = 'force-dynamic';

/** Data older than this is flagged behind (the companion app pushes at least daily). */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function freshness(lastSeen: Date | null, failed: boolean, pending: boolean): SyncState {
  if (failed) return 'error';
  if (pending) return 'syncing';
  if (!lastSeen) return 'never';
  return Date.now() - lastSeen.getTime() < STALE_AFTER_MS ? 'fresh' : 'stale';
}

const BATCH_TONE: Record<BatchInfo['status'], BadgeTone> = {
  received: 'neutral',
  validated: 'accent',
  normalized: 'ok',
  rollups_ready: 'ok',
  failed: 'danger',
};

function sumPoints(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

export default async function SyncPage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null; // the layout renders the no-subject state

  const locale = resolveLocale(ctx.locale);
  const m: Messages = getMessages(locale);
  const tz = ctx.timezone;

  const [overview, batches, volumes, totals, types, observations] = await Promise.all([
    syncOverview(ctx),
    recentBatches(ctx, 15),
    ingestVolumesByDay(ctx, 60),
    dataTotals(ctx),
    topTypes(ctx, 8),
    observationCount(ctx),
  ]);

  const last30 = volumes.slice(30);
  const prev30 = volumes.slice(0, 30);
  const ingested30 = sumPoints(last30.map((v) => v.pointsIngested));
  const ingestedPrev30 = sumPoints(prev30.map((v) => v.pointsIngested));
  const ingestDelta =
    ingested30 === null || ingestedPrev30 === null || ingestedPrev30 === 0
      ? null
      : ((ingested30 - ingestedPrev30) / ingestedPrev30) * 100;

  const globalState = freshness(
    overview.lastReceivedAt,
    batches[0]?.status === 'failed',
    overview.pendingBatches > 0
  );
  const activeDevice = overview.devices.find((d) => d.revokedAt === null);

  const coveredYears =
    totals.firstDay && totals.lastDay
      ? Math.round(
          (Date.parse(totals.lastDay) - Date.parse(totals.firstDay)) / (365.25 * 86_400_000)
        )
      : null;

  const totalMeasures = observations + totals.minuteStats;
  const dayLabel = (day: string | undefined) =>
    day ? fmtDay(day, locale, { day: 'numeric', month: 'short' }) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.sync.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.sync.subtitle}
        </span>
      </header>

      <Panel>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 170 }}>
            <SyncBadge
              state={globalState}
              label={m.syncStatus[globalState]}
              detail={
                overview.lastReceivedAt ? fmtRelative(overview.lastReceivedAt, locale, tz) : undefined
              }
            />
            {activeDevice && (
              <span
                className="tnum"
                style={{ font: '400 var(--text-xs)/1.4 var(--font-data)', color: 'var(--text-3)' }}
              >
                {m.sync.via(activeDevice.name)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', flex: 1 }}>
            <StatTile
              label={m.sync.totalMeasures}
              value={`${m.common.approx} ${fmtCompact(totalMeasures, locale)}`}
              sub={m.sync.totalMeasuresSub(totals.typesWithData)}
            />
            <StatTile
              label={m.sync.coveredPeriod}
              value={coveredYears === null ? null : m.sync.years(coveredYears)}
              sub={
                totals.firstDay && totals.lastDay
                  ? `${fmtDay(totals.firstDay, locale, { month: 'short', year: 'numeric' })} → ${fmtDay(totals.lastDay, locale, { month: 'short', year: 'numeric' })}`
                  : undefined
              }
            />
            <StatTile
              label={m.sync.ingested30d}
              value={ingested30 === null ? null : fmtCompact(ingested30, locale)}
              sub={
                ingestDelta === null ? (
                  m.sync.ingestedSub
                ) : (
                  <TrendChip deltaPct={ingestDelta} label={m.sync.vsPrev30d} locale={locale} />
                )
              }
            />
            <StatTile
              label={m.sync.sessions}
              value={fmtInt(totals.workouts, locale)}
              sub={m.sync.sessionsSub}
            />
          </div>
        </div>
      </Panel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10,
        }}
      >
        {overview.devices.map((d) => {
          const revoked = d.revokedAt !== null;
          const state: SyncState = revoked ? 'never' : freshness(d.lastSeenAt, false, false);
          return (
            <Panel key={d.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <SourceBadge name={d.name} />
                <span style={{ marginLeft: 'auto' }}>
                  <SyncBadge
                    state={state}
                    label={revoked ? m.sync.deviceRevoked : m.syncStatus[state]}
                    detail={d.lastSeenAt ? fmtRelative(d.lastSeenAt, locale, tz) : undefined}
                  />
                </span>
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <StatTile label={m.sync.deviceKey} value={`${d.keyPrefix}…`} sub={d.platform ?? undefined} />
                {/* The subtitle dates what the tile measures: the last push.
                    It carried the PAIRING date, read as "seen on that day",
                    and in UTC, so a push at 01:00 local dated the day before. */}
                <StatTile
                  label={m.sync.lastSeen}
                  value={d.lastSeenAt ? fmtRelative(d.lastSeenAt, locale, tz) : null}
                  sub={d.lastSeenAt ? fmtDay(dayInZone(d.lastSeenAt, tz), locale) : undefined}
                />
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="hy-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12 }}>
        <Panel>
          <PanelLabel
            trailing={
              ingestDelta !== null ? (
                <TrendChip deltaPct={ingestDelta} label={m.sync.vsPrev30d} locale={locale} />
              ) : undefined
            }
          >
            {m.sync.volumesTitle}
          </PanelLabel>
          <BarChart
            data={last30.map((v) => v.pointsIngested)}
            labels={[dayLabel(last30[0]?.day), dayLabel(last30[14]?.day), dayLabel(last30[29]?.day)]}
            color="var(--accent)"
            height={110}
            ariaLabel={m.sync.volumesTitle}
            noDataLabel={m.common.noData}
            format={(v) => fmtInt(v, locale)}
          />
          <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
            {m.sync.volumesNote}
          </p>
        </Panel>

        <Panel padding="6px 10px 10px">
          <div style={{ padding: '8px 2px 0' }}>
            <PanelLabel>{m.sync.topTypesTitle(types.length, totals.typesWithData)}</PanelLabel>
          </div>
          <DataTable
            dense
            rowKey={(r) => String(r.hk)}
            columns={[
              {
                key: 'hk',
                label: m.sync.typeCol,
                render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: dataColor(metricFamily(String(r.hk))),
                        flex: 'none',
                      }}
                    />
                    {metricLabel(String(r.hk), locale)}
                  </span>
                ),
              },
              {
                key: 'count',
                label: m.sync.countCol,
                align: 'right',
                mono: true,
                render: (r) => fmtInt(Number(r.count), locale),
              },
              {
                key: 'share',
                label: m.sync.shareCol,
                align: 'right',
                mono: true,
                muted: true,
                render: (r) =>
                  Number(r.share) < 0.05
                    ? m.sync.lessThanShare
                    : `${fmtNumber(Number(r.share), locale, 1)} %`,
              },
            ]}
            rows={types.map((t) => ({ hk: t.hkIdentifier, count: t.count, share: t.sharePct }))}
          />
        </Panel>
      </div>

      <Panel padding="6px 10px 10px">
        <div style={{ padding: '8px 2px 0' }}>
          <PanelLabel
            trailing={
              <span style={{ font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
                {m.sync.receivedVsVisible}
              </span>
            }
          >
            {m.sync.batchesTitle}
          </PanelLabel>
        </div>
        {batches.length === 0 ? (
          <EmptyState icon="sync" title={m.sync.noBatches} hint={m.sync.noBatchesHint} />
        ) : (
          <DataTable
            dense
            rowKey={(r) => String(r.id)}
            columns={[
              {
                key: 'receivedAt',
                label: m.sync.batchReceived,
                mono: true,
                render: (r) => fmtRelative(r.receivedAt as Date, locale, tz),
              },
              { key: 'deviceName', label: m.sync.batchDevice, muted: true },
              {
                key: 'formatVersion',
                label: m.sync.batchChannel,
                muted: true,
                render: (r) => m.sync.channelNames[String(r.formatVersion)] ?? String(r.formatVersion),
              },
              {
                key: 'status',
                label: m.sync.batchStatusCol,
                render: (r) => (
                  <Badge tone={BATCH_TONE[r.status as BatchInfo['status']]} dot>
                    {m.batchStatus[r.status as BatchInfo['status']]}
                  </Badge>
                ),
              },
              {
                key: 'pointsIngested',
                label: m.sync.batchPoints,
                align: 'right',
                mono: true,
                render: (r) =>
                  r.pointsIngested === null ? null : fmtInt(Number(r.pointsIngested), locale),
              },
              {
                key: 'bodyBytes',
                label: m.sync.batchSize,
                align: 'right',
                mono: true,
                muted: true,
                render: (r) => fmtBytes(Number(r.bodyBytes), locale),
              },
              {
                key: 'attemptCount',
                label: m.sync.batchAttempts,
                align: 'right',
                mono: true,
                muted: true,
              },
              {
                key: 'errorCode',
                label: m.sync.batchError,
                mono: true,
                muted: true,
                render: (r) =>
                  r.errorCode ? `${String(r.errorCode)}${r.errorStep ? ` (${String(r.errorStep)})` : ''}` : null,
              },
            ]}
            rows={batches.map((b) => ({ ...b }))}
          />
        )}
      </Panel>

      <footer style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <span className="tnum" style={{ font: '400 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
          Hygie · self-hosted · AGPL-3.0 ·{' '}
          <a href="https://github.com/letmiko-com/hygie" style={{ color: 'var(--text-3)' }}>
            {m.common.sourceLink}
          </a>
        </span>
      </footer>
    </div>
  );
}
