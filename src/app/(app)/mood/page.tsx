// State of mind (migration 0007): what the subject wrote down in Health about
// how a moment, or a whole day, felt.
//
// The two kinds are drawn as two series and never averaged together: "how do
// I feel right now" and "how has today been" are different questions, and
// merging them would turn a rough morning followed by a good evening into a
// bland day that nobody lived.
//
// Nothing here grades: the colour scale runs cold to warm through neutral and
// says what was logged. An unpleasant week is not a failure state.
import type { Metadata } from 'next';
import { LineChart } from '@/components/charts/LineChart';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { StatTile } from '@/components/data/StatTile';
import { TimeNav } from '@/components/time/TimeNav';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { getMessages, resolveLocale, type Messages } from '@/lib/i18n';
import { classificationColor, valenceColor } from '@/lib/mood';
import { getSubjectContext } from '@/lib/queries/context';
import {
  listMoodEntries,
  moodClassificationCounts,
  moodDailySeries,
  moodTokenCounts,
  moodTotals,
  type MoodEntry,
} from '@/lib/queries/mood';
import { todayInZone } from '@/lib/queries/time';
import { parseTimeParams, type TimeSearchParams } from '@/lib/queries/time-params';
import { dayAxisLabels } from '@/lib/time-format';

export const metadata: Metadata = { title: 'État d’esprit · Hygie' };
export const dynamic = 'force-dynamic';

const MAX_LISTED = 200;

function mean(values: Array<number | null>): number | null {
  const vs = values.filter((v): v is number => v !== null);
  return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0) / vs.length;
}

/** Valence reads as a signed number with one decimal: +0.4 is not 0.4. */
function fmtValence(v: number | null): string | null {
  if (v === null) return null;
  const rounded = Math.round(v * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function TokenBar({
  tokens,
  names,
  total,
}: {
  tokens: Array<{ token: string; count: number }>;
  names: Record<string, string>;
  total: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tokens.map((t) => (
        <div key={t.token} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: '0 0 132px', font: '400 var(--text-sm)/1.3 var(--font-ui)' }}>
            {names[t.token] ?? t.token}
          </span>
          <span
            aria-hidden
            style={{
              flex: `0 0 ${total === 0 ? 0 : (t.count / total) * 60}%`,
              height: 8,
              minWidth: 3,
              borderRadius: 'var(--r-sm)',
              background: 'var(--data-neutral)',
            }}
          />
          <span className="tnum" style={{ font: '500 var(--text-2xs)/1 var(--font-data)', color: 'var(--text-3)' }}>
            {t.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function Distribution({ counts, m }: { counts: Array<{ classification: number; count: number }>; m: Messages }) {
  const total = counts.reduce((a, c) => a + c.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <div
        aria-hidden
        style={{ display: 'flex', height: 14, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface-2)' }}
      >
        {counts.map((c) => (
          <span
            key={c.classification}
            style={{ width: `${(c.count / total) * 100}%`, background: classificationColor(c.classification) }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        {counts.map((c) => (
          <span
            key={c.classification}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '400 var(--text-2xs)/1.2 var(--font-ui)', color: 'var(--text-3)' }}
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: 2, background: classificationColor(c.classification) }}
            />
            {m.mood.classifications[c.classification] ?? c.classification} · {c.count}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function MoodPage({ searchParams }: { searchParams: Promise<TimeSearchParams> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const sp = await searchParams;
  const today = todayInZone(ctx.timezone);
  const totals = await moodTotals(ctx);
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);

  const [days, entries, labels, associations, distribution] = await Promise.all([
    moodDailySeries(ctx, range),
    listMoodEntries(ctx, range, MAX_LISTED),
    moodTokenCounts(ctx, range, 'labels'),
    moodTokenCounts(ctx, range, 'associations'),
    moodClassificationCounts(ctx, range),
  ]);

  const dayKeys: string[] = [];
  for (let d = new Date(`${range.fromDay}T00:00:00Z`); ; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    if (key >= range.toDayExcl) break;
    dayKeys.push(key);
  }
  const byDay = new Map(days.map((d) => [d.day, d]));
  const daily = dayKeys.map((k) => byDay.get(k)?.dailyMood ?? null);
  const momentary = dayKeys.map((k) => byDay.get(k)?.momentary ?? null);

  const windowEntries = days.reduce((a, d) => a + d.entries, 0);
  const hasHistory = totals.entries > 0;
  const labelTotal = labels.reduce((a, t) => a + t.count, 0);
  const associationTotal = associations.reduce((a, t) => a + t.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-2xl)/1.2 var(--font-ui)', margin: 0 }}>{m.mood.title}</h1>
          <span style={{ font: '400 var(--text-sm)/1.3 var(--font-ui)', color: 'var(--text-3)' }}>{m.mood.subtitle}</span>
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
          {m.mood.intro}
        </p>
      </header>

      {!hasHistory ? (
        <Panel>
          <EmptyState icon="mood" title={m.mood.emptyAllTime} hint={m.mood.emptyAllTimeHint} />
        </Panel>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <StatTile
              label={m.mood.dailyMood}
              value={fmtValence(mean(daily))}
              color={mean(daily) === null ? undefined : valenceColor(mean(daily) as number)}
            />
            <StatTile
              label={m.mood.momentary}
              value={fmtValence(mean(momentary))}
              color={mean(momentary) === null ? undefined : valenceColor(mean(momentary) as number)}
            />
            <StatTile label={m.mood.entries} value={fmtInt(windowEntries, locale)} />
          </div>

          <Panel>
            <PanelLabel>{m.mood.trend}</PanelLabel>
            <LineChart
              series={[
                { data: daily, color: 'var(--data-power)', label: m.mood.dailyMood, connect: true },
                { data: momentary, color: 'var(--data-distance)', label: m.mood.momentary, connect: true, dashed: true },
              ]}
              xLabels={dayAxisLabels(
                dayKeys,
                locale,
                4,
                dayKeys.length > 366
                  ? { month: 'short', year: '2-digit' }
                  : { day: 'numeric', month: 'short' }
              )}
              ariaLabel={`${m.mood.trend} — ${m.mood.dailyMood}, ${m.mood.momentary}`}
              emptyLabel={m.mood.empty}
              bounds={{ min: -1, max: 1 }}
              yFormat={(v, digits) => v.toFixed(Math.max(1, digits))}
            />
          </Panel>

          {distribution.length > 0 && (
            <Panel>
              <PanelLabel>{m.mood.distribution}</PanelLabel>
              <Distribution counts={distribution} m={m} />
            </Panel>
          )}

          {(labels.length > 0 || associations.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {labels.length > 0 && (
                <Panel>
                  <PanelLabel>{m.mood.topLabels}</PanelLabel>
                  <TokenBar tokens={labels} names={m.mood.labelNames} total={labelTotal} />
                </Panel>
              )}
              {associations.length > 0 && (
                <Panel>
                  <PanelLabel>{m.mood.topAssociations}</PanelLabel>
                  <TokenBar tokens={associations} names={m.mood.associationNames} total={associationTotal} />
                </Panel>
              )}
            </div>
          )}

          <Panel>
            <PanelLabel>
              {entries.length < windowEntries
                ? m.mood.entriesShown(entries.length, windowEntries)
                : m.mood.entriesCount(entries.length)}
            </PanelLabel>
            {entries.length === 0 ? (
              <EmptyState icon="mood" title={m.mood.empty} hint={m.mood.emptyHint} />
            ) : (
              <DataTable<MoodEntry & Record<string, unknown>>
                rows={entries as Array<MoodEntry & Record<string, unknown>>}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'startTs',
                    label: m.mood.colDate,
                    render: (r) => fmtDateTime(r.startTs, locale, ctx.timezone, true),
                  },
                  { key: 'kind', label: m.mood.colKind, muted: true, render: (r) => m.mood.kinds[r.kind] ?? r.kind },
                  {
                    key: 'valence',
                    label: m.mood.colValence,
                    align: 'right',
                    mono: true,
                    render: (r) => (
                      <span style={{ color: valenceColor(r.valence), fontWeight: 500 }}>
                        {fmtValence(r.valence)}
                        {r.valenceClassification === null
                          ? ''
                          : ` · ${m.mood.classifications[r.valenceClassification] ?? ''}`}
                      </span>
                    ),
                  },
                  {
                    key: 'labels',
                    label: m.mood.colLabels,
                    render: (r) =>
                      r.labels.length === 0
                        ? null
                        : r.labels.map((l) => m.mood.labelNames[l] ?? l).join(', '),
                  },
                  {
                    key: 'associations',
                    label: m.mood.colAssociations,
                    muted: true,
                    render: (r) =>
                      r.associations.length === 0
                        ? null
                        : r.associations.map((a) => m.mood.associationNames[a] ?? a).join(', '),
                  },
                  { key: 'sourceName', label: m.mood.colSource, muted: true },
                ]}
              />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
