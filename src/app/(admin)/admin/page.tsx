// Administration home: every live subject with its instance state (who, which
// devices, whether batches arrive), and the administrator accounts. Reads the
// instance layer only: no health value, no data type (architecture §1).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from '@/components/ui/Link';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/data/EmptyState';
import { SyncBadge } from '@/components/data/SyncBadge';
import { fmtDay, fmtRelative } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getInstanceContext, listAdmins, listMembers } from '@/lib/queries/instance';
import { dayInZone } from '@/lib/queries/time';
import { InvitePanel } from './invite';
import { memberState } from './state';

export const metadata: Metadata = { title: 'Membres · Hygie' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const ictx = await getInstanceContext();
  if (!ictx) notFound();
  const locale = resolveLocale(ictx.locale);
  const m = getMessages(locale);

  const [members, admins] = await Promise.all([listMembers(ictx), listAdmins(ictx)]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 980 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.admin.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)', flex: 1 }}>
          {m.admin.subtitle}
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
        <Icon name="shield_person" size={16} />
        <span>{m.admin.boundary}</span>
      </div>

      <InvitePanel
        defaultLocale={locale}
        defaultTimezone={members[0]?.timezone ?? 'UTC'}
        invitedTitle={m.admin.invitedTitle('{email}')}
        invitedNoMail={m.admin.invitedNoMail('{email}')}
        labels={{
          button: m.admin.inviteButton,
          name: m.admin.inviteName,
          namePlaceholder: m.admin.inviteNamePlaceholder,
          email: m.admin.inviteEmail,
          locale: m.admin.inviteLocale,
          timezone: m.admin.inviteTimezone,
          submit: m.admin.inviteSubmit,
          cancel: m.admin.inviteCancel,
          hint: m.admin.inviteHint,
          invalid: m.admin.inviteInvalid,
          exists: m.admin.inviteExists,
          proxy: m.admin.invitedProxy,
        }}
      />

      {members.length === 0 ? (
        <Panel>
          <EmptyState icon="group" title={m.admin.empty} />
        </Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.map((s) => {
            const state = memberState(s);
            return (
              <Panel key={s.subjectId}>
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
                    <Icon name="person" size={20} />
                  </span>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ font: '500 var(--text-base)/1.25 var(--font-ui)' }}>{s.subjectName}</span>
                      {s.accounts.some((a) => a.isAdmin) && <Badge tone="accent">{m.admin.adminBadge}</Badge>}
                    </div>
                    <span style={{ font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
                      {s.accounts.length > 0 ? s.accounts.map((a) => a.email).join(', ') : m.admin.noAccount}
                    </span>
                  </div>
                  <SyncBadge
                    state={state}
                    label={state === 'never' && s.activeDevices === 0 ? m.admin.noDevice : m.syncStatus[state]}
                    detail={s.lastReceivedAt ? fmtRelative(s.lastReceivedAt, locale, s.timezone) : undefined}
                  />
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      minWidth: 150,
                      font: '400 var(--text-xs)/1.4 var(--font-ui)',
                      color: 'var(--text-2)',
                    }}
                  >
                    <span>{m.admin.activeDevices(s.activeDevices)}</span>
                    {s.failedBatches30d > 0 && (
                      <span style={{ color: 'var(--danger)' }}>{m.admin.failed30d(s.failedBatches30d)}</span>
                    )}
                    {s.pendingBatches > 0 && <span>{m.admin.pending(s.pendingBatches)}</span>}
                  </div>
                  <Link
                    href={`/admin/members/${s.subjectId}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      color: 'var(--accent)',
                      font: '500 var(--text-sm)/1 var(--font-ui)',
                      textDecoration: 'none',
                    }}
                  >
                    {m.admin.details}
                    <Icon name="chevron_right" size={16} />
                  </Link>
                </div>
                <div
                  className="tnum"
                  style={{ marginTop: 8, font: '400 var(--text-2xs)/1.3 var(--font-data)', color: 'var(--text-3)' }}
                >
                  {m.admin.memberSince} {fmtDay(dayInZone(s.createdAt, s.timezone), locale)} · {m.admin.timezone} {s.timezone}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel>
        <PanelLabel>{m.admin.admins}</PanelLabel>
        <ul style={{ margin: '4px 0 6px', paddingLeft: 18, font: '400 var(--text-sm)/1.6 var(--font-ui)' }}>
          {admins.map((a) => (
            <li key={a.email}>
              {a.displayName} <span style={{ color: 'var(--text-3)' }}>· {a.email}</span>
            </li>
          ))}
        </ul>
        <span style={{ font: '400 var(--text-2xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.admin.adminsHint}
        </span>
      </Panel>
    </div>
  );
}
