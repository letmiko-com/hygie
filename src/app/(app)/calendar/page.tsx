// Month calendar (product phase 2, 2026-09-04: fitIQ's "Calendar" read through
// the charter). One month, Monday-first grid: each day shows its sessions
// (sport, start time, duration) and its night (time asleep). The month's
// totals sit above. A day without a session shows nothing, which is what a
// calendar does; a future day is dimmed. Each session opens its detail, each
// day number opens the dashboard on that day.
import type { Metadata } from 'next';
import Link from '@/components/ui/Link';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { fmtDay, fmtDuration, fmtHoursMinutes, fmtInt, fmtKm, fmtNumber } from '@/lib/format';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { getSubjectContext } from '@/lib/queries/context';
import { sleepNights, type SleepNight } from '@/lib/queries/sleep';
import { addDays, addMonths, daysBetween, todayInZone, type DayRange } from '@/lib/queries/time';
import { workoutsInRange, type WorkoutListItem } from '@/lib/queries/workouts';
import { sportDisplay, sportLabel } from '@/lib/sports';

export const metadata: Metadata = { title: 'Calendrier · Hygie' };
export const dynamic = 'force-dynamic';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function localDay(ts: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

interface MonthTotals {
  sessions: number;
  trainingS: number;
  distanceM: number | null;
  sleepMeanS: number | null;
  nights: number;
}

function totals(workouts: WorkoutListItem[], nights: SleepNight[]): MonthTotals {
  const distances = workouts.map((w) => w.distanceM).filter((d): d is number => d !== null);
  const asleep = nights.map((n) => n.asleepS).filter((s): s is number => s !== null);
  return {
    sessions: workouts.length,
    trainingS: workouts.reduce((acc, w) => acc + w.durationS, 0),
    distanceM: distances.length === 0 ? null : distances.reduce((a, b) => a + b, 0),
    sleepMeanS: asleep.length === 0 ? null : asleep.reduce((a, b) => a + b, 0) / asleep.length,
    nights: asleep.length,
  };
}

function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const sp = await searchParams;
  const rawM = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const thisMonth = today.slice(0, 7);
  const month = rawM && MONTH_RE.test(rawM) ? rawM : thisMonth;
  const first = `${month}-01`;
  const nextFirst = addMonths(first, 1);
  const prevFirst = addMonths(first, -1);
  const range: DayRange = { fromDay: first, toDayExcl: nextFirst };
  const prevRange: DayRange = { fromDay: prevFirst, toDayExcl: first };
  // Grid: from the Monday on or before the 1st to the Sunday on or after the last day.
  const gridStart = mondayOf(first);
  const lastDay = addDays(nextFirst, -1);
  const gridEndExcl = addDays(mondayOf(lastDay), 7);
  const gridDays = Array.from({ length: daysBetween(gridStart, gridEndExcl) }, (_, i) => addDays(gridStart, i));

  const [workouts, nights, prevWorkouts, prevNights] = await Promise.all([
    workoutsInRange(ctx, range),
    sleepNights(ctx, range),
    workoutsInRange(ctx, prevRange),
    sleepNights(ctx, prevRange),
  ]);
  const cur = totals(workouts, nights);
  const prev = totals(prevWorkouts, prevNights);
  const workoutsByDay = new Map<string, WorkoutListItem[]>();
  for (const w of workouts) {
    const day = localDay(w.startTs, ctx.timezone);
    workoutsByDay.set(day, [...(workoutsByDay.get(day) ?? []), w]);
  }
  const nightByDay = new Map(nights.map((n) => [n.nightDate, n]));

  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const monthLabel = new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));
  const timeFmt = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone });
  const weekdayFmt = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(`${addDays(gridStart, i)}T00:00:00Z`)).replace('.', ''));

  const navLink = (href: string, label: string, icon?: string) => (
    <Link
      href={href}
      className="hy-btn hy-ghost"
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 32,
        padding: icon ? '0 6px' : '0 10px',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text-2)',
        textDecoration: 'none',
        font: '500 var(--text-sm)/1 var(--font-ui)',
      }}
    >
      {icon ? <Icon name={icon} size={18} /> : label}
    </Link>
  );

  const rows = gridDays.length / 7;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.calendar.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {navLink(`/calendar?m=${prevFirst.slice(0, 7)}`, m.calendar.prevMonth, 'chevron_left')}
          <span style={{ font: '500 var(--text-sm)/1 var(--font-ui)', padding: '0 6px', textTransform: 'capitalize' }}>{monthLabel}</span>
          {month < thisMonth && navLink(`/calendar?m=${nextFirst.slice(0, 7)}`, m.calendar.nextMonth, 'chevron_right')}
          {month !== thisMonth && navLink('/calendar', m.calendar.thisMonth)}
        </div>
      </header>

      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 18 }}>
          <StatTile
            label={m.calendar.sessions}
            value={fmtInt(cur.sessions, locale)}
            sub={<TrendChip deltaPct={deltaPct(cur.sessions, prev.sessions)} label={m.calendar.vsPrevMonth} locale={locale} />}
          />
          <StatTile
            label={m.calendar.training}
            value={cur.sessions === 0 ? null : fmtDuration(cur.trainingS)}
            sub={<TrendChip deltaPct={deltaPct(cur.trainingS, prev.trainingS)} label={m.calendar.vsPrevMonth} locale={locale} />}
          />
          <StatTile
            label={m.calendar.distance}
            value={cur.distanceM === null ? null : fmtNumber(cur.distanceM / 1000, locale, 1)}
            unit="km"
            sub={<TrendChip deltaPct={deltaPct(cur.distanceM, prev.distanceM)} label={m.calendar.vsPrevMonth} locale={locale} />}
          />
          <StatTile
            label={m.calendar.sleepAvg}
            value={cur.sleepMeanS === null ? null : fmtHoursMinutes(cur.sleepMeanS)}
            sub={
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <TrendChip deltaPct={deltaPct(cur.sleepMeanS, prev.sleepMeanS)} label={m.calendar.vsPrevMonth} locale={locale} />
                <span>{m.calendar.nightsMeasured(cur.nights)}</span>
              </span>
            }
          />
        </div>
      </Panel>

      {/* Seven fixed columns: on a phone the grid scrolls inside its panel. */}
      <Panel padding={8} style={{ overflowX: 'auto' }}>
        <div className="hy-scrollx">
          <div
            role="grid"
            aria-label={`${m.calendar.title}, ${monthLabel}`}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(96px, 1fr))', gap: 4, minWidth: 700 }}
          >
            {weekdays.map((d) => (
              <div key={d} role="columnheader" className="hy-label" style={{ padding: '4px 6px 6px' }}>
                {d}
              </div>
            ))}
            {gridDays.map((d) => {
              const inMonth = d >= first && d < nextFirst;
              const future = d > today;
              const isToday = d === today;
              const dayWorkouts = workoutsByDay.get(d) ?? [];
              const night = inMonth ? nightByDay.get(d) : undefined;
              return (
                <div
                  key={d}
                  role="gridcell"
                  style={{
                    minHeight: rows > 5 ? 84 : 96,
                    padding: '6px 6px 8px',
                    borderRadius: 'var(--r-md)',
                    border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`,
                    background: inMonth ? 'var(--surface)' : 'transparent',
                    opacity: inMonth && !future ? 1 : 0.55,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                    <Link
                      href={`/?from=${d}&to=${d}`}
                      aria-label={m.common.drillDay(fmtDay(d, locale))}
                      className="tnum"
                      style={{
                        font: `${isToday ? 600 : 500} var(--text-sm)/1 var(--font-data)`,
                        color: isToday ? 'var(--accent-strong)' : inMonth ? 'var(--text-1)' : 'var(--text-3)',
                        textDecoration: 'none',
                      }}
                    >
                      {Number(d.slice(8, 10))}
                    </Link>
                    {night && night.asleepS !== null && (
                      <Link
                        href={`/sleep?from=${d}&to=${d}`}
                        className="tnum"
                        title={m.calendar.nightTitle(fmtHoursMinutes(night.asleepS))}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          font: '400 var(--text-2xs)/1 var(--font-data)',
                          color: 'var(--text-3)',
                          textDecoration: 'none',
                        }}
                      >
                        <Icon name="bedtime" size={11} color={dataColor('sleep')} />
                        {fmtHoursMinutes(night.asleepS)}
                      </Link>
                    )}
                  </div>
                  {dayWorkouts.map((w) => {
                    const s = sportDisplay(w.activityType);
                    return (
                      <Link
                        key={w.id}
                        href={`/sport/${w.id}`}
                        className="hy-row"
                        title={`${sportLabel(w.activityType, locale)} · ${timeFmt.format(w.startTs)} · ${fmtDuration(w.durationS)}${w.distanceM !== null ? ` · ${fmtKm(w.distanceM, locale)}` : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '3px 5px',
                          borderRadius: 'var(--r-sm)',
                          background: 'var(--surface-2)',
                          color: 'var(--text-1)',
                          textDecoration: 'none',
                          font: '400 var(--text-2xs)/1.2 var(--font-ui)',
                          minWidth: 0,
                        }}
                      >
                        <Icon name={s.icon} size={13} color={dataColor(s.family)} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sportLabel(w.activityType, locale)}
                        </span>
                        <span className="tnum" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-data)' }}>
                          {fmtDuration(w.durationS)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
    </div>
  );
}
