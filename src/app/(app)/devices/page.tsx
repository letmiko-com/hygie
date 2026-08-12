// Devices screen (design reference: design/ui_kits/app/Devices.jsx, adapted
// to reality: pairing means creating a key shown once, entered with the
// server URL in the Hygie Sync app (or wired by hand into a Health Auto
// Export REST automation); the mock's short-code + QR flow comes later).
// Devices are revoked, never deleted.
import type { Metadata } from 'next';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/data/EmptyState';
import { StatTile } from '@/components/data/StatTile';
import { SyncBadge, type SyncState } from '@/components/data/SyncBadge';
import { fmtInt, fmtRelative } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { listDevices } from '@/lib/devices';
import { getSubjectContext } from '@/lib/queries/context';
import { revokeDeviceAction } from './actions';
import { PairPanel, RevokeButton } from './ui';

export const metadata: Metadata = { title: 'Appareils · Hygie' };
export const dynamic = 'force-dynamic';

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function freshness(lastSeen: Date | null): SyncState {
  if (!lastSeen) return 'never';
  return Date.now() - lastSeen.getTime() < STALE_AFTER_MS ? 'fresh' : 'stale';
}

export default async function DevicesPage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const tz = ctx.timezone;

  const devices = await listDevices(ctx);
  const active = devices.filter((d) => d.revokedAt === null);
  const lastPush = devices.reduce<Date | null>(
    (acc, d) => (d.lastSeenAt && (!acc || d.lastSeenAt > acc) ? d.lastSeenAt : acc),
    null
  );
  const serverUrl = (process.env.HYGIE_BASE_URL ?? '').replace(/\/$/, '');
  const ingestUrl = `${serverUrl}/api/v1/ingest/hae`;

  const dateFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 980 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.devices.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)', flex: 1 }}>
          {m.devices.subtitle}
        </span>
      </header>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 12px',
          background: 'var(--surface-2)',
          borderRadius: 'var(--r-md)',
          color: 'var(--text-2)',
          font: '400 var(--text-sm)/1.45 var(--font-ui)',
        }}
      >
        <Icon name="info" size={16} />
        <span>{m.devices.sensorsInfo}</span>
      </div>

      <PairPanel
        serverUrl={serverUrl}
        ingestUrl={ingestUrl}
        labels={{
          pairButton: m.devices.pairButton,
          formName: m.devices.formName,
          formNamePlaceholder: m.devices.formNamePlaceholder,
          formPlatform: m.devices.formPlatform,
          create: m.devices.create,
          cancel: m.devices.cancel,
          keyTitle: m.devices.keyTitle,
          keyOnce: m.devices.keyOnce,
          instructions: m.devices.instructions,
          serverUrlLabel: m.devices.serverUrlLabel,
          altInstructions: m.devices.altInstructions,
          ingestUrlLabel: m.devices.ingestUrlLabel,
          headerLabel: m.devices.headerLabel,
          copy: m.devices.copy,
          copied: m.devices.copied,
          invalid: m.devices.invalid,
          qrLater: m.devices.qrLater,
        }}
      />

      {devices.length === 0 ? (
        <Panel>
          <EmptyState icon="devices" title={m.devices.empty} />
        </Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {devices.map((d) => {
            const revoked = d.revokedAt !== null;
            const state = freshness(d.lastSeenAt);
            return (
              <Panel key={d.id} style={{ opacity: revoked ? 0.65 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 38,
                      height: 38,
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-2)',
                      flex: 'none',
                    }}
                  >
                    <Icon name={d.platform?.toLowerCase().includes('ios') ? 'smartphone' : 'devices'} size={20} />
                  </span>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ font: '500 var(--text-base)/1.25 var(--font-ui)' }}>{d.name}</span>
                      {revoked && <Badge tone="neutral">{m.devices.revokedBadge}</Badge>}
                    </div>
                    <span className="tnum" style={{ font: '400 var(--text-xs)/1.3 var(--font-data)', color: 'var(--text-3)' }}>
                      {d.keyPrefix}… · {m.devices.pairedOn} {dateFmt.format(d.createdAt)}
                    </span>
                  </div>
                  {!revoked && (
                    <SyncBadge
                      state={state}
                      label={m.syncStatus[state]}
                      detail={d.lastSeenAt ? fmtRelative(d.lastSeenAt, locale, tz) : undefined}
                    />
                  )}
                  <span className="tnum" style={{ font: '500 var(--text-sm)/1 var(--font-data)', color: 'var(--text-2)' }}>
                    {fmtInt(d.pushes, locale)}
                    <span style={{ color: 'var(--text-3)', font: '400 var(--text-2xs)/1 var(--font-ui)' }}>
                      {' '}
                      {m.devices.pushes}
                    </span>
                  </span>
                  {!revoked && (
                    <form action={revokeDeviceAction} style={{ display: 'flex' }}>
                      <input type="hidden" name="deviceId" value={d.id} />
                      <RevokeButton label={m.devices.revoke} confirmText={m.devices.confirmRevoke} />
                    </form>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', padding: '2px 4px' }}>
        <StatTile label={m.devices.activeTile} value={fmtInt(active.length, locale)} />
        <StatTile label={m.devices.lastPushTile} value={lastPush ? fmtRelative(lastPush, locale, tz) : null} />
      </div>
    </div>
  );
}
