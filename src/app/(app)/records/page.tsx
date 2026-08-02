// Simple records screen (design reference: design/ui_kits/app/Records.jsx).
// Every record is a real whole session (no derived race times in the MVP);
// cards carry a yearly-best sparkline and a 12-month trend whose color
// encodes quality (a green downward pace is an improvement). Clicking a
// record opens the session that set it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkline } from '@/components/charts/Sparkline';
import { LineChart } from '@/components/charts/LineChart';
import { DataTable } from '@/components/data/DataTable';
import { EmptyState } from '@/components/data/EmptyState';
import { TrendChip } from '@/components/data/TrendChip';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { fmtDay, fmtDuration, fmtInt, fmtNumber, fmtPace } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { sportDisplay, sportLabel } from '@/lib/sports';
import { getSubjectContext } from '@/lib/queries/context';
import {
  allWorkoutsLite,
  sportRecords,
  type RecordKind,
  type SportRecord,
} from '@/lib/queries/records';

export const metadata: Metadata = { title: 'Records · Hygie' };
export const dynamic = 'force-dynamic';

function fmtRecordValue(r: SportRecord, locale: Locale): string {
  switch (r.kind) {
    case 'longest_distance':
      return `${fmtNumber(r.value / 1000, locale, 1)} km`;
    case 'longest_duration':
      return fmtDuration(r.value);
    case 'best_pace':
      return fmtPace(r.value);
    case 'best_speed':
      return `${fmtNumber(r.value, locale, 1)} km/h`;
    case 'biggest_climb':
      return `${fmtInt(r.value, locale)} m`;
  }
}

/** One emblematic record per sport: pace for running, speed for cycling,
 * otherwise the longest distance, falling back to the longest duration. */
function emblematicKind(activityType: string): RecordKind[] {
  if (activityType === 'HKWorkoutActivityTypeRunning') return ['best_pace', 'longest_distance'];
  if (activityType === 'HKWorkoutActivityTypeCycling') return ['best_speed', 'longest_distance'];
  return ['longest_distance', 'longest_duration'];
}

function RecordCard({
  record,
  locale,
  m,
  tz,
}: {
  record: SportRecord;
  locale: Locale;
  m: Messages;
  tz: string;
}) {
  const sport = sportDisplay(record.activityType);
  const color = dataColor(sport.family);
  const dateFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz,
  });
  return (
    <Link
      href={`/sport/${record.workoutId}`}
      className="hy-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 14,
        textDecoration: 'none',
        color: 'inherit',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name={sport.icon} size={15} color={color} />
        <span className="hy-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sportLabel(record.activityType, locale)} · {m.records.kinds[record.kind]}
        </span>
        {record.recent && (
          <Badge tone="accent" dot>
            {m.records.newBadge}
          </Badge>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="tnum" style={{ font: '600 var(--text-2xl)/1 var(--font-ui)' }}>
          {fmtRecordValue(record, locale)}
        </span>
        <span className="tnum" style={{ font: '400 var(--text-xs)/1 var(--font-data)', color: 'var(--text-3)', marginLeft: 'auto' }}>
          {dateFmt.format(record.date)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Sparkline values={record.progression.map((p) => p.value)} color={color} height={26} />
        </div>
        <TrendChip deltaPct={record.deltaPct} invert={record.invert} label={m.records.trendCol} locale={locale} />
      </div>
    </Link>
  );
}

export default async function RecordsPage() {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);

  const workouts = await allWorkoutsLite(ctx);
  if (workouts.length === 0) {
    return (
      <Panel>
        <EmptyState icon="trophy" title={m.records.empty} />
      </Panel>
    );
  }

  const now = new Date();
  const countBySport = new Map<string, number>();
  for (const w of workouts) countBySport.set(w.activityType, (countBySport.get(w.activityType) ?? 0) + 1);
  // Sports with a real history only: records over 2 sessions are noise.
  const sports = [...countBySport.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  const allRecords = sports.flatMap((s) => sportRecords(workouts, s, now));

  // Featured cards: one emblematic record per sport (by session count), up to 6.
  const featured: SportRecord[] = [];
  for (const s of sports) {
    if (featured.length >= 6) break;
    for (const kind of emblematicKind(s)) {
      const r = allRecords.find((x) => x.activityType === s && x.kind === kind);
      if (r) {
        featured.push(r);
        break;
      }
    }
  }

  // Progression panel: the featured record with the densest yearly history.
  const density = (r: SportRecord) => r.progression.filter((p) => p.value !== null).length;
  const progRecord = [...featured].sort((a, b) => density(b) - density(a))[0];
  const progSport = progRecord ? sportDisplay(progRecord.activityType) : null;
  const progIsPace = progRecord?.kind === 'best_pace';
  const progValues = progRecord
    ? progRecord.progression.map((p) => (p.value === null ? null : progIsPace ? p.value / 60 : p.value))
    : [];
  const progYears = progRecord ? progRecord.progression.map((p) => String(p.year)) : [];

  const dateFmtShort = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: ctx.timezone,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0 }}>{m.records.title}</h1>
        <span style={{ font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.records.subtitle}
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        {featured.map((r) => (
          <RecordCard key={`${r.activityType}-${r.kind}`} record={r} locale={locale} m={m} tz={ctx.timezone} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(280px, 4fr)', gap: 12 }}>
        <Panel padding="6px 10px 10px">
          <div style={{ padding: '8px 2px 0' }}>
            <PanelLabel>{m.records.tableTitle}</PanelLabel>
          </div>
          <DataTable
            dense
            rowKey={(r) => `${r.sport}-${r.kind}`}
            columns={[
              {
                key: 'sport',
                label: m.records.sportCol,
                render: (r) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon
                      name={sportDisplay(String(r.sport)).icon}
                      size={14}
                      color={dataColor(sportDisplay(String(r.sport)).family)}
                    />
                    {sportLabel(String(r.sport), locale)}
                  </span>
                ),
              },
              { key: 'event', label: m.records.eventCol, muted: true },
              {
                key: 'value',
                label: m.records.recordCol,
                align: 'right',
                mono: true,
                render: (r) => (
                  <Link href={`/sport/${String(r.workoutId)}`} style={{ color: 'var(--text-1)', textDecoration: 'none' }}>
                    {String(r.value)}
                  </Link>
                ),
              },
              {
                key: 'date',
                label: m.records.dateCol,
                align: 'right',
                mono: true,
                muted: true,
                render: (r) => dateFmtShort.format(r.date as Date),
              },
              {
                key: 'trend',
                label: m.records.trendCol,
                align: 'right',
                render: (r) =>
                  r.deltaPct === null ? null : (
                    <TrendChip deltaPct={Number(r.deltaPct)} invert={Boolean(r.invert)} locale={locale} />
                  ),
              },
            ]}
            rows={allRecords.map((r) => ({
              sport: r.activityType,
              kind: r.kind,
              event: m.records.kinds[r.kind],
              value: fmtRecordValue(r, locale),
              date: r.date,
              deltaPct: r.deltaPct,
              invert: r.invert,
              workoutId: r.workoutId,
            }))}
          />
        </Panel>

        {progRecord && progSport && (
          <Panel>
            <PanelLabel
              trailing={
                <TrendChip deltaPct={progRecord.deltaPct} invert={progRecord.invert} label={m.records.vsPrevYear} locale={locale} />
              }
            >
              {m.records.progressionTitle(
                `${sportLabel(progRecord.activityType, locale)} · ${m.records.kinds[progRecord.kind]}`
              )}
            </PanelLabel>
            <LineChart
              height={168}
              ariaLabel={m.records.progressionTitle(m.records.kinds[progRecord.kind])}
              yFormat={(v) => (progIsPace ? fmtNumber(v, locale, 1) : String(Math.round(v)))}
              xLabels={progYears.filter((_, i) => i % Math.ceil(progYears.length / 8) === 0)}
              series={[{ data: progValues, color: dataColor(progSport.family), area: true }]}
            />
            <p style={{ font: '400 var(--text-xs)/1.5 var(--font-ui)', color: 'var(--text-3)', margin: '10px 0 0' }}>
              {m.records.progressionNote}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
