// Recent activity timeline: nights, sessions and records actually broken,
// merged into ONE antichronological stream grouped by local day.
//
// Window: the timeline is anchored on the END of the visible period and looks
// back a fixed number of days from there (never on the period's start). A
// dashboard opened on the 2nd of a month must still show what happened last
// week; bounding the lookback on both sides would make the panel empty for
// most of every month. Time navigation still moves it: the anchor is the
// period's last day, clamped to today.
//
// Cost: the nights come from the shared sleep pipeline (one winning source
// per night, HAE summaries over derived aggregation — never duplicated here),
// the sessions from one indexed descending scan, the records from the single
// light all-workouts query the records screen already uses. "No data != zero"
// applies to the whole panel: a day without entries simply does not exist in
// the stream, it is never rendered as an empty day.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { getMetricType } from './metric-types';
import { allWorkoutsLite, recordEvents, type RecordKind } from './records';
import { sleepNights } from './sleep';
import { addDays, dayInZone, type DayRange } from './time';

/** Days looked back from the end of the visible period. */
export const TIMELINE_LOOKBACK_DAYS = 30;
/** Hard cap on rendered entries: a timeline is a glance, not a log. */
export const TIMELINE_MAX_ENTRIES = 10;
/**
 * Nights happen every single day, sessions and records do not. Without a
 * separate ceiling a quiet fortnight of sleep pushes every workout out of the
 * panel and the timeline stops being about activity. Nights keep the majority
 * of the slots, they just stop taking all of them.
 */
export const TIMELINE_MAX_NIGHTS = 5;
/**
 * Records are the rarest and most notable entry of all: they are never
 * displaced by the cap, only capped themselves (a first season can beat a
 * handful of marks in one session).
 */
export const TIMELINE_MAX_RECORDS = 4;

export interface TimelineWorkout {
  kind: 'workout';
  id: string;
  ts: Date;
  day: string;
  activityType: string;
  durationS: number;
  distanceM: number | null;
  energyKj: number | null;
  avgHrBpm: number | null;
  sourceName: string;
}

export interface TimelineNight {
  kind: 'night';
  /** Wake instant when known, otherwise local midnight of the wake day. */
  ts: Date;
  day: string;
  asleepS: number | null;
  deepS: number | null;
  coreS: number | null;
  remS: number | null;
  awakeS: number | null;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  sourceName: string | null;
}

export interface TimelineRecord {
  kind: 'record';
  ts: Date;
  day: string;
  recordKind: RecordKind;
  activityType: string;
  workoutId: string;
  value: number;
  previous: number;
  invert: boolean;
}

export type TimelineEntry = TimelineWorkout | TimelineNight | TimelineRecord;

export interface TimelineDay {
  day: string;
  entries: TimelineEntry[];
}

export interface ActivityTimeline {
  window: DayRange;
  days: TimelineDay[];
  /** True when the cap cut the stream: the UI can offer "see all". */
  truncated: boolean;
}

/**
 * Lookback window for a visible period: [end - LOOKBACK, end), where end is
 * the period's last day clamped to today (a period reaching into the future
 * must not shift the window forward).
 */
export function timelineWindow(range: DayRange, today: string): DayRange {
  const tomorrow = addDays(today, 1);
  const endExcl = range.toDayExcl > tomorrow ? tomorrow : range.toDayExcl;
  return { fromDay: addDays(endExcl, -TIMELINE_LOOKBACK_DAYS), toDayExcl: endExcl };
}

interface WorkoutRow {
  id: string;
  activity_type: string;
  source_name: string;
  start_ts: Date;
  duration_s: number;
  distance_m: number | null;
  energy_kj: number | null;
  avg_hr_bpm: number | null;
}

async function timelineWorkouts(
  ctx: SubjectContext,
  window: DayRange,
  limit: number
): Promise<TimelineWorkout[]> {
  const hrType = await getMetricType('HKQuantityTypeIdentifierHeartRate');
  const { rows } = await getDb().query<WorkoutRow>(
    `select w.id, w.activity_type, s.name as source_name, w.start_ts,
            w.duration_s, w.distance_m, w.energy_kj, hr.avg_hr_bpm
     from workouts w
     join sources s on s.id = w.source_id
     cross join lateral (
       select avg(o.value) as avg_hr_bpm
       from observations o
       where o.subject_id = w.subject_id and o.type_id = $2
         and o.start_ts >= w.start_ts and o.start_ts < w.end_ts
     ) hr
     where w.subject_id = $1
       and w.start_ts >= ($3::date::timestamp at time zone $5)
       and w.start_ts < ($4::date::timestamp at time zone $5)
     order by w.start_ts desc
     limit $6`,
    [ctx.subjectId, hrType.id, window.fromDay, window.toDayExcl, ctx.timezone, limit]
  );
  return rows.map((r) => ({
    kind: 'workout' as const,
    id: r.id,
    ts: r.start_ts,
    day: dayInZone(r.start_ts, ctx.timezone),
    activityType: r.activity_type,
    durationS: r.duration_s,
    distanceM: r.distance_m,
    energyKj: r.energy_kj,
    avgHrBpm: r.avg_hr_bpm,
    sourceName: r.source_name,
  }));
}

/**
 * The merged stream for a visible period. Entries are capped AFTER the merge
 * so a busy week of sessions cannot push the nights out and vice versa: the
 * cap applies to the timeline, not to each source.
 */
export async function activityTimeline(
  ctx: SubjectContext,
  range: DayRange,
  today: string,
  maxEntries: number = TIMELINE_MAX_ENTRIES
): Promise<ActivityTimeline> {
  const window = timelineWindow(range, today);

  const [workouts, nights, allWorkouts] = await Promise.all([
    timelineWorkouts(ctx, window, maxEntries),
    sleepNights(ctx, window),
    allWorkoutsLite(ctx),
  ]);

  const inWindow = (ts: Date): boolean => {
    const day = dayInZone(ts, ctx.timezone);
    return day >= window.fromDay && day < window.toDayExcl;
  };

  const nightEntries: TimelineNight[] = nights.map((n) => ({
    kind: 'night' as const,
    // Wake time places the night at its natural spot in the morning of its
    // wake date; without it, local midnight of that date.
    ts: n.sleepEnd ?? new Date(`${n.nightDate}T00:00:00Z`),
    day: n.nightDate,
    asleepS: n.asleepS,
    deepS: n.deepS,
    coreS: n.coreS,
    remS: n.remS,
    awakeS: n.awakeS,
    sleepStart: n.sleepStart,
    sleepEnd: n.sleepEnd,
    sourceName: n.sourceName,
  }));

  const recordEntries: TimelineRecord[] = recordEvents(allWorkouts, inWindow).map((e) => ({
    kind: 'record' as const,
    ts: e.ts,
    day: dayInZone(e.ts, ctx.timezone),
    recordKind: e.kind,
    activityType: e.activityType,
    workoutId: e.workoutId,
    value: e.value,
    previous: e.previous,
    invert: e.invert,
  }));

  const byRecency = (a: TimelineEntry, b: TimelineEntry): number => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    return b.ts.getTime() - a.ts.getTime();
  };

  const recentNights = [...nightEntries].sort(byRecency).slice(0, TIMELINE_MAX_NIGHTS);
  const recentRecords = [...recordEntries].sort(byRecency).slice(0, TIMELINE_MAX_RECORDS);
  const merged: TimelineEntry[] = [...workouts, ...recentNights, ...recentRecords].sort(byRecency);

  // Records first into the budget, then the rest by recency: without this a
  // quiet fortnight of nights pushes a record broken three weeks ago out of
  // the panel, which is exactly the entry nobody wants to miss.
  const budget = Math.max(maxEntries, recentRecords.length);
  const keptSet = new Set<TimelineEntry>(recentRecords);
  for (const entry of merged) {
    if (keptSet.size >= budget) break;
    keptSet.add(entry);
  }
  const kept = merged.filter((entry) => keptSet.has(entry));
  const days: TimelineDay[] = [];
  for (const entry of kept) {
    const last = days[days.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }

  return { window, days, truncated: merged.length > kept.length };
}
