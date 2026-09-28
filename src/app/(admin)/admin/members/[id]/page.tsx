// One member's instance state: accounts, devices (revocable, never created
// here), daily totals received over 30 days, and the recent batches. Reads the
// instance layer only: all types summed, batch errors as code and step, no
// health value and no data type (architecture §1).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from '@/components/ui/Link';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { RevokeButton } from '@/components/ui/RevokeButton';
import { BarChart } from '@/components/charts/BarChart';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { StatTile } from '@/components/data/StatTile';
import { SyncBadge, type SyncState } from '@/components/data/SyncBadge';
import { fmtBytes, fmtDay, fmtInt, fmtRelative } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getInstanceContext, memberDetail, type MemberBatch } from '@/lib/queries/instance';
import { dayInZone } from '@/lib/queries/time';
import { staleAfterMs } from '@/lib/silence';
import { revokeMemberDeviceAction } from '../../actions';
import { memberState } from '../../state';

export const metadata: Metadata = { title: 'Membre · Hygie' };
export const dynamic = 'force-dynamic';

const BATCH_TONE: Record<MemberBatch['status'], BadgeTone> = {
  received: 'neutral',
  validated: 'accent',
  normalized: 'ok',
  rollups_ready: 'ok',
  failed: 'danger',
};

function deviceFreshness(lastSeen: Date | null): SyncState {
  if (!lastSeen) return 'never';
  return Date.now() - lastSeen.getTime() < staleAfterMs() ? 'fresh' : 'stale';
}

function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const ictx = await getInstanceContext();
  if (!ictx) notFound();
  const { id } = await params;
  const locale = resolveLocale(ictx.locale);
  const m = getMessages(locale);

  const detail = await memberDetail(ictx, id);
  if (!detail) {
    return (
      <Panel>
        <EmptyState icon="person_off" title={m.admin.notFound} />
      </Panel>
    );
  }
  const { summary, devices, batches, volumes } = detail;
  const tz = summary.timezone;
  const state = memberState(summary);
  const batches30d = volumes.reduce((a, v) => a + v.batches, 0);
  const points30d = sumOrNull(volumes.map((v) => v.pointsIngested));
  const dayLabel = (day: string | undefined) => (day ? fmtDay(day, locale, { day: 'numeric', month: 'short' }) : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1180 }}>
      <Link
        href="/admin"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          color: 'var(--text-3)',
          font: '500 var(--text-sm)/1 var(--font-ui)',
          textDecoration: 'none',
        }}
      >
        <Icon name="chevron_left" size={16} />
        {m.admin.back}
      </Link>

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{summary.subjectName}</h1>
        <SyncBadge
          state={state}
          label={state === 'never' && summary.activeDevices === 0 ? m.admin.noDevice : m.syncStatus[state]}
          detail={summary.lastReceivedAt ? fmtRelative(summary.lastReceivedAt, locale, tz) : undefined}
        />
      </header>

      <Panel>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px', minWidth: 0 }}>
            <PanelLabel>{m.admin.accounts}</PanelLabel>
            {summary.accounts.length === 0 ? (
              <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
                {m.admin.noAccount}
              </span>
            ) : (
              summary.accounts.map((a) => (
                <span key={a.email} style={{ font: '400 var(--text-sm)/1.5 var(--font-ui)' }}>
                  {a.displayName} <span style={{ color: 'var(--text-3)' }}>· {a.email}</span>{' '}
                  {a.isAdmin && <Badge tone="accent">{m.admin.adminBadge}</Badge>}
                </span>
              ))
            )}
            <span className="tnum" style={{ font: '400 var(--text-2xs)/1.4 var(--font-data)', color: 'var(--text-3)' }}>
              {m.admin.memberSince} {fmtDay(dayInZone(summary.createdAt, tz), locale)} · {m.admin.timezone} {tz}
            </span>
          </div>
          <StatTile label={m.admin.lastBatch} value={summary.lastReceivedAt ? fmtRelative(summary.lastReceivedAt, locale, tz) : null} />
          <StatTile label={m.admin.batches30d} value={fmtInt(batches30d, locale)} />
          <StatTile label={m.admin.points30d} value={points30d === null ? null : fmtInt(points30d, locale)} />
        </div>
      </Panel>

      <Panel>
        <PanelLabel>{m.admin.devicesTitle}</PanelLabel>
        <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '0 0 8px' }}>
          {m.admin.devicesHint}
        </p>
        {devices.length === 0 ? (
          <EmptyState icon="devices" title={m.admin.noDevice} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {devices.map((d) => {
              const revoked = d.revokedAt !== null;
              const fresh = deviceFreshness(d.lastSeenAt);
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '8px 10px',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface-2)',
                    opacity: revoked ? 0.65 : 1,
                  }}
                >
                  <Icon name={d.platform?.toLowerCase().includes('ios') ? 'smartphone' : 'devices'} size={18} />
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ font: '500 var(--text-sm)/1.25 var(--font-ui)' }}>{d.name}</span>
                      {revoked && <Badge tone="neutral">{m.devices.revokedBadge}</Badge>}
                    </div>
                    <span className="tnum" style={{ font: '400 var(--text-2xs)/1.3 var(--font-data)', color: 'var(--text-3)' }}>
                      {d.keyPrefix}… · {m.devices.pairedOn} {fmtDay(dayInZone(d.createdAt, tz), locale)}
                      {d.platform ? ` · ${d.platform}` : ''}
                    </span>
                  </div>
                  {!revoked && (
                    <SyncBadge
                      state={fresh}
                      label={m.syncStatus[fresh]}
                      detail={d.lastSeenAt ? fmtRelative(d.lastSeenAt, locale, tz) : undefined}
                    />
                  )}
                  <span className="tnum" style={{ font: '500 var(--text-sm)/1 var(--font-data)', color: 'var(--text-2)' }}>
                    {fmtInt(d.pushes, locale)}
                    <span style={{ color: 'var(--text-3)', font: '400 var(--text-2xs)/1 var(--font-ui)' }}> {m.devices.pushes}</span>
                  </span>
                  {!revoked && (
                    <form action={revokeMemberDeviceAction} style={{ display: 'flex' }}>
                      <input type="hidden" name="subjectId" value={summary.subjectId} />
                      <input type="hidden" name="deviceId" value={d.id} />
                      <RevokeButton label={m.devices.revoke} confirmText={m.admin.confirmRevoke} />
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelLabel>{m.admin.volumesTitle}</PanelLabel>
        <BarChart
          data={volumes.map((v) => v.pointsIngested)}
          labels={[dayLabel(volumes[0]?.day), dayLabel(volumes[14]?.day), dayLabel(volumes[volumes.length - 1]?.day)]}
          color="var(--accent)"
          height={110}
          ariaLabel={m.admin.volumesTitle}
          noDataLabel={m.common.noData}
          format={(v) => fmtInt(v, locale)}
        />
        <p style={{ font: '400 var(--text-2xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
          {m.admin.volumesNote}
        </p>
      </Panel>

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
          <EmptyState icon="sync" title={m.sync.noBatches} />
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
                  <Badge tone={BATCH_TONE[r.status as MemberBatch['status']]} dot>
                    {m.batchStatus[r.status as MemberBatch['status']]}
                  </Badge>
                ),
              },
              {
                key: 'pointsIngested',
                label: m.sync.batchPoints,
                align: 'right',
                mono: true,
                render: (r) => (r.pointsIngested === null ? null : fmtInt(Number(r.pointsIngested), locale)),
              },
              {
                key: 'bodyBytes',
                label: m.sync.batchSize,
                align: 'right',
                mono: true,
                muted: true,
                render: (r) => fmtBytes(Number(r.bodyBytes), locale),
              },
              { key: 'attemptCount', label: m.sync.batchAttempts, align: 'right', mono: true, muted: true },
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
    </div>
  );
}
