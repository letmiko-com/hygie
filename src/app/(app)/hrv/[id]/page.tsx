// One heartbeat series read as a curve: the delay between consecutive beats
// over the minute the watch recorded. The four figures above it are the ones
// computed at ingestion (src/lib/hrv.ts) over the valid intervals only, so
// what the tachogram shows and what the numbers say cannot diverge.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Tachogram } from '@/components/charts/Tachogram';
import { EmptyState } from '@/components/data/EmptyState';
import { StatTile } from '@/components/data/StatTile';
import Link from '@/components/ui/Link';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime, fmtDuration, fmtInt } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { getSubjectContext } from '@/lib/queries/context';
import { getHeartbeatSeries } from '@/lib/queries/hrv';

export const metadata: Metadata = { title: 'Série de battements · Hygie' };
export const dynamic = 'force-dynamic';

export default async function HeartbeatSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const { id } = await params;
  const series = await getHeartbeatSeries(ctx, id);
  if (!series) notFound();

  const fmt = (v: number | null) => (v === null ? null : fmtInt(v, locale));
  const when = fmtDateTime(series.startTs, locale, ctx.timezone, true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>{when}</h1>
        <span style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>
          {series.sourceName}
          {series.durationS === null ? '' : ` · ${fmtDuration(Math.round(series.durationS))}`}
          {` · ${series.gapCount > 0 ? m.hrv.gaps(series.gapCount) : m.hrv.noGap}`}
        </span>
        <Link href="/hrv" style={{ color: 'var(--accent-strong)', font: '500 var(--text-sm)/1 var(--font-ui)' }}>
          {m.hrv.backToList}
        </Link>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <StatTile label={m.hrv.rmssd} value={fmt(series.rmssdMs)} unit="ms" />
        <StatTile label={m.hrv.sdnn} value={fmt(series.sdnnMs)} unit="ms" />
        <StatTile label={m.hrv.pnn50} value={fmt(series.pnn50Pct)} unit="%" />
        <StatTile label={m.hrv.meanRr} value={fmt(series.meanRrMs)} unit="ms" />
        <StatTile label={m.hrv.meanHr} value={fmt(series.meanHrBpm)} unit="bpm" />
        <StatTile label={m.hrv.beatsLabel} value={fmtInt(series.beatCount, locale)} />
      </div>

      <Panel>
        <PanelLabel>{m.hrv.tachogram}</PanelLabel>
        {series.intervalsMs.length === 0 ? (
          <EmptyState icon="monitor_heart" title={m.hrv.empty} hint={m.hrv.emptyHint} />
        ) : (
          <>
            <Tachogram
              intervalsMs={series.intervalsMs}
              ariaLabel={`${m.hrv.tachogram} — ${when}`}
              yUnit=" ms"
              xUnit=" s"
            />
            <p
              style={{
                margin: '10px 0 0',
                maxWidth: 760,
                font: '400 var(--text-2xs)/1.5 var(--font-ui)',
                color: 'var(--text-3)',
              }}
            >
              {m.hrv.tachogramHint}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
