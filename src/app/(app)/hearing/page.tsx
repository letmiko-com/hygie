// Hearing: every audiogram stored in Health, newest first, each drawn on a
// clinical chart (frequency on a log axis, hearing level downwards, one
// curve per ear). A handful of rows at most, so everything is read whole.
import type { Metadata } from 'next';
import { AudiogramChart } from '@/components/charts/AudiogramChart';
import { EmptyState } from '@/components/data/EmptyState';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { listAudiograms } from '@/lib/queries/hearing';

export const metadata: Metadata = { title: 'Audition · Hygie' };
export const dynamic = 'force-dynamic';

export default async function HearingPage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const audiograms = await listAudiograms(ctx);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>{m.hearing.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{m.hearing.subtitle}</span>
      </header>

      {audiograms.length === 0 ? (
        <Panel>
          <EmptyState icon="hearing" title={m.hearing.empty} hint={m.hearing.emptyHint} />
        </Panel>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
          {audiograms.map((a) => {
            const clamped = a.points.some((p) => p.clamped !== null);
            return (
              <Panel key={a.id}>
                <PanelLabel
                  trailing={
                    <span style={{ font: '400 var(--text-2xs)/1 var(--font-ui)', color: 'var(--text-3)' }}>
                      {a.sourceName}
                      {clamped ? ` · ${m.hearing.clamped}` : ''}
                    </span>
                  }
                >
                  {fmtDateTime(a.startTs, locale, ctx.timezone, true)}
                </PanelLabel>
                <AudiogramChart
                  points={a.points}
                  ariaLabel={`${m.hearing.title} ${fmtDateTime(a.startTs, locale, ctx.timezone, true)}`}
                  labels={{ left: m.hearing.left, right: m.hearing.right, hz: m.hearing.hz, dbHl: m.hearing.dbHl }}
                />
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
