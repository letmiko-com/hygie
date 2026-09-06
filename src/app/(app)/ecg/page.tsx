// ECG list: every recording, newest first, with Apple's classification as
// a badge whose tone encodes what the classification means (sinus rhythm
// reads calm, atrial fibrillation reads alarming, inconclusive reads as a
// caution). Clicking a row opens the trace.
import type { Metadata } from 'next';
import Link from '@/components/ui/Link';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime, fmtDuration, fmtInt } from '@/lib/format';
import { classificationTone } from '@/lib/ecg';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { ecgClassificationCounts, listEcgs, type EcgListItem } from '@/lib/queries/ecg';

export const metadata: Metadata = { title: 'ECG · Hygie' };
export const dynamic = 'force-dynamic';

export default async function EcgListPage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const [recordings, mix] = await Promise.all([listEcgs(ctx), ecgClassificationCounts(ctx)]);
  const label = (c: string) => m.ecg.classification[c] ?? c;

  type Row = EcgListItem & Record<string, unknown>;
  const rows = recordings as Row[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>{m.ecg.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{m.ecg.subtitle}</span>
      </header>

      {recordings.length === 0 ? (
        <Panel>
          <EmptyState icon="cardiology" title={m.ecg.empty} hint={m.ecg.emptyHint} />
        </Panel>
      ) : (
        <Panel>
          <PanelLabel
            trailing={
              <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {mix.map((c) => (
                  <Badge key={c.classification} tone={classificationTone(c.classification)}>
                    {fmtInt(c.count, locale)} · {label(c.classification)}
                  </Badge>
                ))}
              </span>
            }
          >
            {m.ecg.recordings(recordings.length)}
          </PanelLabel>
          <DataTable<Row>
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'startTs',
                label: m.ecg.colDate,
                render: (r) => (
                  <Link href={`/ecg/${r.id}`} style={{ color: 'var(--accent-strong)', textDecoration: 'none', fontWeight: 500 }}>
                    {fmtDateTime(r.startTs, locale, ctx.timezone, true)}
                  </Link>
                ),
              },
              {
                key: 'classification',
                label: m.ecg.colClass,
                render: (r) => <Badge tone={classificationTone(r.classification)}>{label(r.classification)}</Badge>,
              },
              {
                key: 'avgHrBpm',
                label: m.ecg.colHr,
                align: 'right',
                mono: true,
                render: (r) => (r.avgHrBpm === null ? null : `${fmtInt(r.avgHrBpm, locale)} bpm`),
              },
              {
                key: 'symptomsStatus',
                label: m.ecg.colSymptoms,
                muted: true,
                render: (r) => m.ecg.symptoms[r.symptomsStatus] ?? r.symptomsStatus,
              },
              {
                key: 'duration',
                label: m.ecg.colDuration,
                align: 'right',
                mono: true,
                render: (r) => fmtDuration(Math.round(r.nSamples / r.samplingHz)),
              },
              { key: 'sourceName', label: m.ecg.colSource, muted: true },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
