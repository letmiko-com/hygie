// One ECG: the facts Apple attached (classification, symptoms, average
// heart rate, sampling) and the trace on standard paper, three strips of
// ten seconds. Unknown id -> real 404 (not-found.tsx), unparseable id never
// reaches the database.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from '@/components/ui/Link';
import { EcgTrace } from '@/components/charts/EcgTrace';
import { StatTile } from '@/components/data/StatTile';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime, fmtDuration, fmtInt, fmtNumber } from '@/lib/format';
import { classificationTone } from '@/lib/ecg';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { getEcg } from '@/lib/queries/ecg';

export const metadata: Metadata = { title: 'ECG · Hygie' };
export const dynamic = 'force-dynamic';

export default async function EcgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const { id } = await params;
  const ecg = /^[0-9a-f-]{36}$/i.test(id) ? await getEcg(ctx, id) : null;
  if (!ecg) notFound();

  const durationS = ecg.nSamples / ecg.samplingHz;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Link
        href="/ecg"
        className="hy-ghost"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', textDecoration: 'none', color: 'var(--text-2)', font: '500 var(--text-sm)/1 var(--font-ui)', padding: '4px 6px', borderRadius: 'var(--r-sm)' }}
      >
        <Icon name="arrow_back" size={15} />
        {m.ecg.back}
      </Link>

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>
          {fmtDateTime(ecg.startTs, locale, ctx.timezone, true)}
        </h1>
        <Badge tone={classificationTone(ecg.classification)}>
          {m.ecg.classification[ecg.classification] ?? ecg.classification}
        </Badge>
        <span style={{ font: '400 var(--text-sm)/1 var(--font-ui)', color: 'var(--text-3)' }}>{ecg.sourceName}</span>
      </header>

      <Panel>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <StatTile label={m.ecg.avgHr} value={ecg.avgHrBpm === null ? null : fmtInt(ecg.avgHrBpm, locale)} unit="bpm" color="var(--data-heart)" />
          <StatTile label={m.ecg.duration} value={fmtDuration(Math.round(durationS))} />
          <StatTile label={m.ecg.colSymptoms} value={m.ecg.symptoms[ecg.symptomsStatus] ?? ecg.symptomsStatus} />
          <StatTile label={m.ecg.sampling} value={fmtNumber(ecg.samplingHz, locale, 0)} unit="Hz" />
          <StatTile label={m.ecg.samples} value={fmtInt(ecg.nSamples, locale)} />
          <StatTile label={m.ecg.algorithm} value={ecg.algorithmVersion === null ? null : `v${ecg.algorithmVersion}`} />
          <StatTile label={m.ecg.lead} value={ecg.lead === 'apple_watch_similar_to_lead_i' ? m.ecg.leadAppleWatch : ecg.lead} />
        </div>
      </Panel>

      <Panel>
        <PanelLabel
          trailing={<span style={{ font: '400 var(--text-2xs)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{m.ecg.traceHint}</span>}
        >
          {m.ecg.trace}
        </PanelLabel>
        <EcgTrace
          voltagesUv={ecg.voltagesUv}
          samplingHz={ecg.samplingHz}
          ariaLabel={m.ecg.trace}
          stripLabel={(a, b) => m.ecg.strip(a, b)}
        />
      </Panel>
    </div>
  );
}
