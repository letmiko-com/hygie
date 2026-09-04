// Weekly review (product phase 2, 2026-09-04: fitIQ's "Training load" week read
// through the charter). One ISO week, Monday to Sunday: what was trained, how
// the nights went, what the resting markers did, day by day, against the
// previous week. No strain, no recovery score, no balance verdict: the week's
// facts side by side, the reader draws the line.
//
// A week in progress is compared pro rata: its elapsed days against the same
// first days of the previous week, otherwise "Wednesday so far vs a full week"
// lies on every total. Future days state nothing (no data != zero); a past day
// without a session is a real "no session".
import type { Metadata } from 'next';
import Link from '@/components/ui/Link';
import { BarChart } from '@/components/charts/BarChart';
import { DataTable, type Column } from '@/components/data/DataTable';
import { StatTile } from '@/components/data/StatTile';
import { TrendChip } from '@/components/data/TrendChip';
import { Icon } from '@/components/ui/Icon';
import { Panel, PanelLabel } from '@/components/ui/Panel';
import { drillSet, drillZone } from '@/lib/drill';
import { ABSENT, fmtDay, fmtDuration, fmtHoursMinutes, fmtInt, fmtKm, fmtNumber, kjToKcal } from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { getSubjectContext, type SubjectContext } from '@/lib/queries/context';
import { dailySeries, type DailyPoint } from '@/lib/queries/series';
import { sleepNights, type SleepNight } from '@/lib/queries/sleep';
import { addDays, daysBetween, isDay, todayInZone, type DayRange } from '@/lib/queries/time';
import { workoutsInRange, type WorkoutListItem } from '@/lib/queries/workouts';
import { sportDisplay, sportLabel } from '@/lib/sports';
import { rangeLabel } from '@/lib/time-format';

export const metadata: Metadata = { title: 'Bilan hebdomadaire · Hygie' };
export const dynamic = 'force-dynamic';

const HK = {
  restingHr: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  steps: 'HKQuantityTypeIdentifierStepCount',
  energy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
};

function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Sum of the non-null values, null when there is none. */
function sum(values: Array<number | null>): number | null {
  const vs = values.filter((v): v is number => v !== null);
  return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0);
}

function mean(values: Array<number | null>): number | null {
  const vs = values.filter((v): v is number => v !== null);
  return vs.length === 0 ? null : vs.reduce((a, b) => a + b, 0) / vs.length;
}

function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

interface WeekFacts {
  days: string[];
  workoutsByDay: Map<string, WorkoutListItem[]>;
  nightsByDay: Map<string, SleepNight>;
  restingHr: Array<number | null>;
  hrv: Array<number | null>;
  steps: Array<number | null>;
  energyKj: Array<number | null>;
  /** Training seconds per day; 0 on a past day without a session, null on a future day. */
  trainingS: Array<number | null>;
}

function facts(
  days: string[],
  workouts: WorkoutListItem[],
  nights: SleepNight[],
  series: Record<keyof typeof HK, DailyPoint[]>,
  today: string,
  timeZone: string
): WeekFacts {
  const workoutsByDay = new Map<string, WorkoutListItem[]>();
  for (const w of workouts) {
    // A session belongs to the local day it started on, in the subject's zone.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(w.startTs);
    const list = workoutsByDay.get(day) ?? [];
    list.push(w);
    workoutsByDay.set(day, list);
  }
  const nightsByDay = new Map(nights.map((n) => [n.nightDate, n]));
  const pick = (points: DailyPoint[]) => days.map((d) => points.find((p) => p.day === d)?.value ?? null);
  return {
    days,
    workoutsByDay,
    nightsByDay,
    restingHr: pick(series.restingHr),
    hrv: pick(series.hrv),
    steps: pick(series.steps),
    energyKj: pick(series.energy),
    trainingS: days.map((d) =>
      d > today ? null : (workoutsByDay.get(d) ?? []).reduce((acc, w) => acc + w.durationS, 0)
    ),
  };
}

interface Tile {
  key: string;
  label: string;
  value: string | null;
  unit?: string;
  delta: number | null;
  invert?: boolean;
}

/** Week figures over the first `n` days, so a week in progress compares like for like. */
function tiles(cur: WeekFacts, prev: WeekFacts, n: number, locale: Locale, m: Messages): Tile[] {
  const head = <T,>(xs: T[]) => xs.slice(0, n);
  const sessions = (f: WeekFacts) => head(f.days).reduce((acc, d) => acc + (f.workoutsByDay.get(d)?.length ?? 0), 0);
  const training = (f: WeekFacts) => sum(head(f.trainingS));
  const distance = (f: WeekFacts) =>
    sum(head(f.days).flatMap((d) => (f.workoutsByDay.get(d) ?? []).map((w) => w.distanceM)));
  const sleep = (f: WeekFacts) => mean(head(f.days).map((d) => f.nightsByDay.get(d)?.asleepS ?? null));
  const tile = (
    key: string,
    label: string,
    c: number | null,
    p: number | null,
    write: (v: number) => string,
    unit?: string,
    invert?: boolean
  ): Tile => ({ key, label, value: c === null ? null : write(c), unit, delta: deltaPct(c, p), invert });
  const curSessions = n === 0 ? null : sessions(cur);
  return [
    tile('sessions', m.week.sessions, curSessions, sessions(prev), (v) => fmtInt(v, locale)),
    tile('training', m.week.training, training(cur), training(prev), (v) => fmtDuration(v)),
    tile('distance', m.week.distance, distance(cur), distance(prev), (v) => fmtNumber(v / 1000, locale, 1), 'km'),
    tile('energy', m.week.energy, sum(head(cur.energyKj)), sum(head(prev.energyKj)), (v) => fmtInt(kjToKcal(v), locale), 'kcal'),
    tile('steps', m.week.stepsPerDay, mean(head(cur.steps)), mean(head(prev.steps)), (v) => fmtInt(v, locale)),
    tile('sleep', m.week.sleepAvg, sleep(cur), sleep(prev), (v) => fmtHoursMinutes(v)),
    tile('restingHr', m.week.restingHr, mean(head(cur.restingHr)), mean(head(prev.restingHr)), (v) => fmtInt(v, locale), 'bpm', true),
    tile('hrv', m.week.hrv, mean(head(cur.hrv)), mean(head(prev.hrv)), (v) => fmtInt(v, locale), 'ms'),
  ];
}

interface DayRow extends Record<string, unknown> {
  day: string;
  future: boolean;
  workouts: WorkoutListItem[];
  night: SleepNight | undefined;
  restingHr: number | null;
  hrv: number | null;
  steps: number | null;
  energyKj: number | null;
}

export default async function WeekPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx: SubjectContext | null = await getSubjectContext();
  if (!ctx) return null;
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const today = todayInZone(ctx.timezone);

  const sp = await searchParams;
  const rawW = Array.isArray(sp.w) ? sp.w[0] : sp.w;
  const thisMonday = mondayOf(today);
  // The URL carries the week's Monday; anything else snaps to its own Monday.
  const monday = rawW && isDay(rawW) ? mondayOf(rawW) : thisMonday;
  const isCurrent = monday === thisMonday;
  const cur: DayRange = { fromDay: monday, toDayExcl: addDays(monday, 7) };
  const prev: DayRange = { fromDay: addDays(monday, -7), toDayExcl: monday };
  const both: DayRange = { fromDay: prev.fromDay, toDayExcl: cur.toDayExcl };
  const curDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const prevDays = Array.from({ length: 7 }, (_, i) => addDays(prev.fromDay, i));
  // Days of the week that are over or in progress: the comparison basis.
  const elapsed = monday > today ? 0 : Math.min(7, daysBetween(monday, today) + 1);

  const [curWorkouts, prevWorkouts, curNights, prevNights, restingHr, hrv, steps, energy] = await Promise.all([
    workoutsInRange(ctx, cur),
    workoutsInRange(ctx, prev),
    sleepNights(ctx, cur),
    sleepNights(ctx, prev),
    dailySeries(ctx, HK.restingHr, both),
    dailySeries(ctx, HK.hrv, both),
    dailySeries(ctx, HK.steps, both),
    dailySeries(ctx, HK.energy, both),
  ]);
  const series = { restingHr: restingHr.points, hrv: hrv.points, steps: steps.points, energy: energy.points };
  const curFacts = facts(curDays, curWorkouts, curNights, series, today, ctx.timezone);
  const prevFacts = facts(prevDays, prevWorkouts, prevNights, series, today, ctx.timezone);
  const cards = tiles(curFacts, prevFacts, elapsed, locale, m);

  const weekdayFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
  const dayLetter = (d: string) => weekdayFmt.format(new Date(`${d}T00:00:00Z`)).replace('.', '');
  const timeFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ctx.timezone });

  const rows: DayRow[] = curDays.map((d, i) => ({
    day: d,
    future: d > today,
    workouts: curFacts.workoutsByDay.get(d) ?? [],
    night: curFacts.nightsByDay.get(d),
    restingHr: curFacts.restingHr[i],
    hrv: curFacts.hrv[i],
    steps: curFacts.steps[i],
    energyKj: curFacts.energyKj[i],
  }));
  const num = (v: number | null, write: (v: number) => string) => (v === null ? ABSENT : write(v));
  const columns: Array<Column<DayRow>> = [
    {
      key: 'day',
      label: m.week.colDay,
      render: (r) => (
        <span style={{ fontWeight: r.day === today ? 600 : 400, color: r.future ? 'var(--text-3)' : undefined }}>
          {fmtDay(r.day, locale, { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
      ),
    },
    {
      key: 'sessions',
      label: m.week.colSessions,
      render: (r) =>
        r.future ? (
          <span style={{ color: 'var(--text-3)' }}>{ABSENT}</span>
        ) : r.workouts.length === 0 ? (
          <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>{m.week.noSession}</span>
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {r.workouts.map((w) => {
              const s = sportDisplay(w.activityType);
              return (
                <Link
                  key={w.id}
                  href={`/sport/${w.id}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-1)', textDecoration: 'none' }}
                >
                  <Icon name={s.icon} size={14} color={dataColor(s.family)} />
                  <span>{sportLabel(w.activityType, locale)}</span>
                  <span className="tnum" style={{ color: 'var(--text-3)' }}>
                    {timeFmt.format(w.startTs)} · {fmtDuration(w.durationS)}
                    {w.distanceM !== null ? ` · ${fmtKm(w.distanceM, locale)}` : ''}
                  </span>
                </Link>
              );
            })}
          </span>
        ),
    },
    { key: 'sleep', label: m.week.colSleep, align: 'right', mono: true, render: (r) => num(r.night?.asleepS ?? null, (v) => fmtHoursMinutes(v)) },
    { key: 'restingHr', label: m.week.colRestingHr, align: 'right', mono: true, render: (r) => num(r.restingHr, (v) => fmtInt(v, locale)) },
    { key: 'hrv', label: m.week.colHrv, align: 'right', mono: true, render: (r) => num(r.hrv, (v) => fmtInt(v, locale)) },
    { key: 'steps', label: m.week.colSteps, align: 'right', mono: true, render: (r) => num(r.steps, (v) => fmtInt(v, locale)) },
    { key: 'energy', label: m.week.colEnergy, align: 'right', mono: true, render: (r) => num(r.energyKj, (v) => fmtInt(kjToKcal(v), locale)) },
  ];

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ font: '600 var(--text-xl)/1.2 var(--font-ui)', margin: 0, flex: 1 }}>{m.week.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {navLink(`/week?w=${prev.fromDay}`, m.week.prevWeek, 'chevron_left')}
          <span className="tnum" style={{ font: '500 var(--text-sm)/1 var(--font-data)', padding: '0 6px' }}>
            {rangeLabel(null, cur, locale)}
          </span>
          {monday < thisMonday && navLink(`/week?w=${addDays(monday, 7)}`, m.week.nextWeek, 'chevron_right')}
          {!isCurrent && navLink('/week', m.week.thisWeek)}
        </div>
      </header>
      {isCurrent && elapsed < 7 && (
        <p style={{ margin: 0, font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-3)' }}>
          {m.week.elapsedNote(elapsed)}
        </p>
      )}

      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 18 }}>
          {cards.map((t) => (
            <StatTile
              key={t.key}
              label={t.label}
              value={t.value}
              unit={t.unit}
              sub={<TrendChip deltaPct={t.delta} invert={t.invert} label={m.week.vsPrevWeek} locale={locale} />}
            />
          ))}
        </div>
      </Panel>

      <div className="hy-split" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <Panel>
          <PanelLabel>{m.week.trainingPerDay}</PanelLabel>
          <BarChart
            data={curFacts.trainingS.map((s) => (s === null ? null : s / 60))}
            labels={curDays.map(dayLetter)}
            color={dataColor('activity')}
            height={110}
            ariaLabel={m.week.trainingPerDay}
            noDataLabel={m.common.noData}
            format={(v) => `${fmtInt(v, locale)} min`}
            drill={drillSet(
              curDays.map((d) => (d > today ? null : drillZone({ fromDay: d, toDay: d }, `/sport?from=${d}&to=${d}`, locale, m))),
              locale,
              m
            )}
          />
        </Panel>
        <Panel>
          <PanelLabel>{m.week.sleepPerDay}</PanelLabel>
          <BarChart
            data={curDays.map((d) => {
              const s = curFacts.nightsByDay.get(d)?.asleepS ?? null;
              return s === null ? null : s / 3600;
            })}
            labels={curDays.map(dayLetter)}
            color={dataColor('sleep')}
            height={110}
            ariaLabel={m.week.sleepPerDay}
            noDataLabel={m.common.noData}
            format={(v) => fmtHoursMinutes(v * 3600)}
            drill={drillSet(
              curDays.map((d) =>
                curFacts.nightsByDay.get(d) ? drillZone({ fromDay: d, toDay: d }, `/sleep?from=${d}&to=${d}`, locale, m) : null
              ),
              locale,
              m
            )}
          />
        </Panel>
      </div>

      <Panel padding={6}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.day} />
      </Panel>
    </div>
  );
}
