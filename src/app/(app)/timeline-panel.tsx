// Dashboard "recent activity" panel: the merged nights / sessions / records
// stream, rendered by the reusable ActivityTimeline. Kept in its own async
// component so the dashboard can stream it: its three queries must not hold
// back the metric cards.
//
// Entry mapping lives here (labels, units, links) rather than in the query
// layer: the queries return facts, the screen decides how a fact reads.
import { EmptyState } from '@/components/data/EmptyState';
import { SkeletonLines } from '@/components/data/Skeleton';
import {
  ActivityTimeline,
  type TimelineGroup,
  type TimelineItem,
} from '@/components/data/ActivityTimeline';
import {
  fmtDay,
  fmtDuration,
  fmtHoursMinutes,
  fmtInt,
  fmtKm,
  fmtNumber,
  fmtPace,
} from '@/lib/format';
import { getMessages, resolveLocale, type Locale, type Messages } from '@/lib/i18n';
import { dataColor } from '@/lib/metrics';
import { sportDisplay, sportLabel } from '@/lib/sports';
import type { SubjectContext } from '@/lib/queries/context';
import {
  activityTimeline,
  TIMELINE_LOOKBACK_DAYS,
  type TimelineEntry,
  type TimelineNight,
  type TimelineRecord,
  type TimelineWorkout,
} from '@/lib/queries/timeline';
import { addDays, type DayRange } from '@/lib/queries/time';

function hhmm(date: Date | null, locale: Locale, timeZone: string): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

/** Record value in the unit its kind is measured in. */
function recordValue(entry: TimelineRecord, locale: Locale): string {
  switch (entry.recordKind) {
    case 'longest_distance':
      return fmtKm(entry.value, locale);
    case 'longest_duration':
      return fmtDuration(entry.value);
    case 'best_pace':
      return fmtPace(entry.value);
    case 'best_speed':
      return `${fmtNumber(entry.value, locale, 1)} km/h`;
    case 'biggest_climb':
      return `${fmtInt(entry.value, locale)} m`;
  }
}

function recordPrevious(entry: TimelineRecord, locale: Locale): string {
  return recordValue({ ...entry, value: entry.previous }, locale);
}

function nightItem(entry: TimelineNight, locale: Locale, m: Messages, timeZone: string): TimelineItem {
  const from = hhmm(entry.sleepStart, locale, timeZone);
  const to = hhmm(entry.sleepEnd, locale, timeZone);
  const meta = [
    from && to ? `${from} → ${to}` : null,
    entry.deepS === null || entry.deepS === 0
      ? m.timeline.nightNoStages
      : `${m.timeline.deep} ${fmtHoursMinutes(entry.deepS)}`,
    entry.awakeS !== null && entry.awakeS > 0 ? `${m.timeline.awake} ${fmtHoursMinutes(entry.awakeS)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    key: `night-${entry.day}`,
    // A night has no detail screen of its own: the sleep screen focused on
    // that single night is the closest honest destination.
    href: `/sleep?from=${entry.day}&to=${entry.day}`,
    icon: 'bedtime',
    color: dataColor('sleep'),
    title: m.timeline.night,
    meta,
    stats: [
      {
        label: m.timeline.asleep,
        value: entry.asleepS === null ? null : fmtHoursMinutes(entry.asleepS),
        color: dataColor('sleep'),
      },
    ],
  };
}

function workoutItem(
  entry: TimelineWorkout,
  locale: Locale,
  m: Messages,
  timeZone: string
): TimelineItem {
  const sport = sportDisplay(entry.activityType);
  const meta = [
    hhmm(entry.ts, locale, timeZone),
    fmtDuration(entry.durationS),
    entry.distanceM === null ? null : fmtKm(entry.distanceM, locale),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    key: `workout-${entry.id}`,
    href: `/sport/${entry.id}`,
    icon: sport.icon,
    color: dataColor(sport.family),
    title: sportLabel(entry.activityType, locale),
    meta,
    stats: [
      {
        label: m.timeline.hr,
        value: entry.avgHrBpm === null ? null : fmtInt(entry.avgHrBpm, locale),
        color: 'var(--data-heart)',
      },
    ],
  };
}

function recordItem(entry: TimelineRecord, locale: Locale, m: Messages): TimelineItem {
  return {
    key: `record-${entry.workoutId}-${entry.recordKind}`,
    href: `/sport/${entry.workoutId}`,
    icon: 'trophy',
    color: dataColor('power'),
    title: m.timeline.recordTitle(
      m.records.kinds[entry.recordKind] ?? entry.recordKind,
      sportLabel(entry.activityType, locale)
    ),
    meta: m.timeline.beats(recordPrevious(entry, locale)),
    stats: [{ label: m.records.recordCol, value: recordValue(entry, locale), color: dataColor('power') }],
    badge: { label: m.timeline.recordBadge, tone: 'accent' },
  };
}

function toItem(entry: TimelineEntry, locale: Locale, m: Messages, timeZone: string): TimelineItem {
  switch (entry.kind) {
    case 'night':
      return nightItem(entry, locale, m, timeZone);
    case 'workout':
      return workoutItem(entry, locale, m, timeZone);
    case 'record':
      return recordItem(entry, locale, m);
  }
}

function dayLabel(day: string, today: string, locale: Locale, m: Messages): { label: string; sub?: string } {
  if (day === today) return { label: m.timeline.today, sub: fmtDay(day, locale, { day: 'numeric', month: 'short' }) };
  if (day === addDays(today, -1)) {
    return { label: m.timeline.yesterday, sub: fmtDay(day, locale, { day: 'numeric', month: 'short' }) };
  }
  return {
    label: fmtDay(day, locale, { weekday: 'long', day: 'numeric', month: 'short' }),
  };
}

export function TimelineSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ padding: '4px 8px 8px' }}>
      <SkeletonLines lines={6} height={28} gap={12} />
    </div>
  );
}

export async function TimelinePanel({
  ctx,
  range,
  today,
}: {
  ctx: SubjectContext;
  range: DayRange;
  today: string;
}) {
  const locale = resolveLocale(ctx.locale);
  const m = getMessages(locale);
  const timeline = await activityTimeline(ctx, range, today);

  if (timeline.days.length === 0) {
    return <EmptyState icon="timeline" title={m.timeline.empty} hint={m.timeline.emptyHint} />;
  }

  const groups: TimelineGroup[] = timeline.days.map((d) => ({
    day: d.day,
    ...dayLabel(d.day, today, locale, m),
    items: d.entries.map((entry) => toItem(entry, locale, m, ctx.timezone)),
  }));

  return <ActivityTimeline groups={groups} />;
}

export { TIMELINE_LOOKBACK_DAYS };
