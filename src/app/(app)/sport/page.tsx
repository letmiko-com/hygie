// Session list (design reference: design/ui_kits/app/Sport.jsx): summary
// band with trends, per-sport tabs (links, URL is the state), sessions
// grouped by month, all under the shared time navigation.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SessionRow } from '@/components/data/SessionRow';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { EmptyState } from '@/components/data/EmptyState';
import { BarChart } from '@/components/charts/BarChart';
import { LinkTabs, type LinkTab } from '@/components/ui/LinkTabs';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { TimeNav } from '@/components/time/TimeNav';
import { TimeScrubber } from '@/components/time/TimeScrubber';
import { fmtDay, fmtDuration, fmtHoursMinutes, fmtInt, fmtKcalFromKj, fmtKm } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { sportDisplay, sportLabel } from '@/lib/sports';
import { getSubjectContext } from '@/lib/queries/context';
import { dataTotals } from '@/lib/queries/sync';
import { comparisonRange, daysBetween, elapsedDays, todayInZone } from '@/lib/queries/time';
import { parseTimeParams, type TimeSearchParams } from '@/lib/queries/time-params';
import {
  monthlyTrainingSilhouette,
  weeklyVolume,
  workoutCountsByActivity,
  workoutsInRange,
  workoutSummary,
  type WorkoutListItem,
} from '@/lib/queries/workouts';

export const metadata: Metadata = { title: 'Sport · Hygie' };
export const dynamic = 'force-dynamic';

/** Sessions per page. All-time held ~1000 rows, i.e. 4.7 MB of HTML. */
const PAGE_SIZE = 50;

function pct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export default async function SportPage({
  searchParams,
}: {
  searchParams: Promise<TimeSearchParams & { sport?: string }>;
}) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const totals = await dataTotals(ctx);
  const sp = await searchParams;
  const { preset, range, compare } = parseTimeParams(sp, today, totals.firstDay);
  const sport = typeof sp.sport === 'string' && /^HKWorkoutActivityType\w+$/.test(sp.sport) ? sp.sport : undefined;

  const elapsed = elapsedDays(range, today);
  const prevRange = comparisonRange(preset, range, elapsed);
  const rangeDays = daysBetween(range.fromDay, range.toDayExcl);

  const summary = await workoutSummary(ctx, range, sport);
  // The requested page is clamped to what the period actually holds, so a
  // hand-written ?page=999 shows the last page instead of an empty list.
  const pageCount = Math.max(1, Math.ceil(summary.count / PAGE_SIZE));
  const rawPage = Number.parseInt(typeof sp.page === 'string' ? sp.page : '', 10);
  const pageNo = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), pageCount) : 1;

  const [prevSummary, counts, list, weeks, silhouette] = await Promise.all([
    workoutSummary(ctx, prevRange, sport),
    workoutCountsByActivity(ctx, range),
    workoutsInRange(ctx, range, sport, { limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE }),
    rangeDays <= 200 ? weeklyVolume(ctx, range) : Promise.resolve(null),
    monthlyTrainingSilhouette(ctx),
  ]);

  // Tabs: every sport present on the period, ordered by count.
  const timeQuery = new URLSearchParams();
  if (preset) timeQuery.set('p', preset);
  const anchor = typeof sp.a === 'string' ? sp.a : undefined;
  if (anchor) timeQuery.set('a', anchor);
  if (typeof sp.from === 'string' && typeof sp.to === 'string') {
    timeQuery.set('from', sp.from);
    timeQuery.set('to', sp.to);
  }
  if (compare) timeQuery.set('compare', '1');
  const tabHref = (s?: string) => {
    const q = new URLSearchParams(timeQuery);
    if (s) q.set('sport', s);
    const qs = q.toString();
    return `/sport${qs ? `?${qs}` : ''}`;
  };
  const pageHref = (n: number) => {
    const q = new URLSearchParams(timeQuery);
    if (sport) q.set('sport', sport);
    if (n > 1) q.set('page', String(n));
    const qs = q.toString();
    return `/sport${qs ? `?${qs}` : ''}`;
  };
  const totalCount = counts.reduce((a, c) => a + c.count, 0);
  const tabs: LinkTab[] = [
    { href: tabHref(), label: m.sport.allTab, count: totalCount, active: !sport },
    ...counts.map((c) => ({
      href: tabHref(c.activityType),
      label: sportLabel(c.activityType, locale),
      count: c.count,
      active: sport === c.activityType,
    })),
  ];

  // Month groups, subject-local.
  const monthKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: ctx.timezone });
  const monthLabelFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: ctx.timezone,
  });
  const dayFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: ctx.timezone,
  });
  const groups: Array<{ label: string; items: WorkoutListItem[] }> = [];
  let currentKey = '';
  for (const w of list) {
    const key = monthKeyFmt.format(w.startTs);
    if (key !== currentKey) {
      groups.push({ label: monthLabelFmt.format(w.startTs), items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(w);
  }

  const tiles = [
    {
      label: m.sport.sessions,
      value: fmtInt(summary.count, locale),
      delta: pct(summary.count, prevSummary.count),
      invert: false,
    },
    {
      label: m.sport.totalDuration,
      value: summary.count === 0 ? null : fmtHoursMinutes(summary.totalDurationS),
      delta: pct(summary.totalDurationS, prevSummary.totalDurationS),
      invert: false,
    },
    {
      label: m.sport.distance,
      value: summary.totalDistanceM === null ? null : fmtKm(summary.totalDistanceM, locale, 0),
      delta: pct(summary.totalDistanceM, prevSummary.totalDistanceM),
      invert: false,
    },
    {
      label: m.sport.energy,
      value: summary.totalEnergyKj === null ? null : fmtKcalFromKj(summary.totalEnergyKj, locale),
      delta: pct(summary.totalEnergyKj, prevSummary.totalEnergyKj),
      invert: false,
    },
    {
      label: m.sport.avgSessionHr,
      value: summary.avgHrBpm === null ? null : `${fmtInt(summary.avgHrBpm, locale)} bpm`,
      delta: pct(summary.avgHrBpm, prevSummary.avgHrBpm),
      invert: true,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.sport.title}</h1>
          <TimeNav
            preset={preset}
            range={range}
            compare={compare}
            firstDataDay={totals.firstDay}
            today={today}
            locale={locale}
            labels={m.timenav}
          />
        </div>
        {totals.firstDay && (
          <TimeScrubber
            startDay={totals.firstDay}
            endDay={today}
            range={range}
            data={silhouette}
            compare={compare}
            startLabel={fmtDay(totals.firstDay, locale, { month: 'short', year: 'numeric' })}
            endLabel={fmtDay(today, locale, { month: 'short', year: 'numeric' })}
            ariaLabel={m.timenav.scrubber}
          />
        )}
      </header>

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <Panel style={{ flex: '1 1 480px' }}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {tiles.map((t) => (
              <StatTile
                key={t.label}
                label={t.label}
                value={t.value}
                sub={
                  t.delta === null ? undefined : (
                    <TrendChip deltaPct={t.delta} invert={t.invert} label={m.dash.vsPrevPeriod} locale={locale} />
                  )
                }
              />
            ))}
          </div>
        </Panel>
        {weeks && weeks.length > 1 && weeks.length <= 30 && (
          <Panel style={{ flex: '0 1 320px', minWidth: 240 }}>
            <PanelLabel>{m.sport.sessionsPerWeek}</PanelLabel>
            <BarChart
              data={weeks.map((w) => w.sessions)}
              color={dataColor('activity')}
              height={64}
              ariaLabel={m.sport.sessionsPerWeek}
              noDataLabel={m.common.noData}
              format={(v) => fmtInt(v, locale)}
            />
          </Panel>
        )}
      </div>

      <LinkTabs tabs={tabs} ariaLabel={m.sport.title} />

      {list.length === 0 ? (
        <Panel>
          <EmptyState icon="exercise" title={m.sport.empty} hint={m.sport.emptyHint} />
        </Panel>
      ) : (
        <Panel padding={6}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="hy-label" style={{ padding: '10px 12px 4px' }}>
                {g.label}
              </div>
              {g.items.map((w) => {
                const s = sportDisplay(w.activityType);
                return (
                  <SessionRow
                    key={w.id}
                    href={`/sport/${w.id}`}
                    icon={s.icon}
                    color={dataColor(s.family)}
                    title={sportLabel(w.activityType, locale)}
                    meta={[dayFmt.format(w.startTs), fmtDuration(w.durationS), w.distanceM === null ? null : fmtKm(w.distanceM, locale)]
                      .filter(Boolean)
                      .join(' · ')}
                    stats={[
                      {
                        label: 'FC',
                        value: w.avgHrBpm === null ? null : fmtInt(w.avgHrBpm, locale),
                        color: 'var(--data-heart)',
                      },
                      {
                        label: 'kcal',
                        value: w.energyKj === null ? null : fmtInt((w.energyKj / 4.184), locale),
                      },
                    ]}
                    sourceName={w.sourceName}
                  />
                );
              })}
            </div>
          ))}
        </Panel>
      )}

      {pageCount > 1 && (
        <nav
          aria-label={m.sport.pagination}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
        >
          <PageLink href={pageHref(pageNo - 1)} disabled={pageNo === 1} label={m.sport.prevPage} />
          <span
            className="tnum"
            style={{ font: '400 var(--text-sm)/1 var(--font-data)', color: 'var(--text-2)' }}
          >
            {m.sport.pageOf(pageNo, pageCount)}
          </span>
          <PageLink href={pageHref(pageNo + 1)} disabled={pageNo === pageCount} label={m.sport.nextPage} />
        </nav>
      )}
    </div>
  );
}

/** A disabled page control must not stay clickable: it renders as plain text. */
function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    height: 'var(--control-h-md)',
    padding: '0 12px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border-strong)',
    font: '500 var(--text-sm)/1 var(--font-ui)',
    color: disabled ? 'var(--text-3)' : 'var(--text-1)',
    opacity: disabled ? 0.5 : 1,
  };
  if (disabled) {
    return (
      <span aria-disabled style={style}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className="hy-btn" style={{ ...style, textDecoration: 'none' }}>
      {label}
    </Link>
  );
}
