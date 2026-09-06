// State of mind (state_of_mind, migration 0007): what the subject logged in
// Health about how they felt. Two kinds share the table — a momentary emotion
// and a whole-day mood — and they are never mixed in an average: they answer
// two different questions ("right now" vs "today overall").
//
// Days are computed in the subject's zone, and every read tolerates the
// table's absence until 0007 is applied.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { untilMigrated } from './optional';
import type { DayRange } from './time';

export type MoodKind = 'momentary_emotion' | 'daily_mood';

export interface MoodEntry {
  id: string;
  startTs: Date;
  tzOffsetMin: number;
  kind: MoodKind;
  valence: number;
  valenceClassification: number | null;
  labels: string[];
  associations: string[];
  sourceName: string;
}

export interface MoodDay {
  day: string;
  /** Mean valence of the day, per kind: never averaged together. */
  dailyMood: number | null;
  momentary: number | null;
  entries: number;
}

const num = (v: string | number | null): number | null =>
  v === null ? null : typeof v === 'number' ? v : Number(v);

interface DayRow {
  day: string;
  daily_mood: string | number | null;
  momentary: string | number | null;
  entries: number;
}

export async function moodDailySeries(ctx: SubjectContext, range: DayRange): Promise<MoodDay[]> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<DayRow>(
          `select (start_ts at time zone $4)::date::text as day,
                  avg(valence) filter (where kind = 'daily_mood') as daily_mood,
                  avg(valence) filter (where kind = 'momentary_emotion') as momentary,
                  count(*)::int as entries
           from state_of_mind
           where subject_id = $1
             and start_ts >= ($2::date::timestamp at time zone $4)
             and start_ts < ($3::date::timestamp at time zone $4)
           group by 1 order by 1`,
          [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone]
        )
      ).rows,
    [] as DayRow[]
  );
  return rows.map((r) => ({
    day: r.day,
    dailyMood: num(r.daily_mood),
    momentary: num(r.momentary),
    entries: r.entries,
  }));
}

interface EntryRow {
  id: string;
  start_ts: Date;
  tz_offset_min: number;
  kind: MoodKind;
  valence: number;
  valence_classification: number | null;
  labels: string[];
  associations: string[];
  source_name: string;
}

export async function listMoodEntries(
  ctx: SubjectContext,
  range: DayRange,
  limit = 200
): Promise<MoodEntry[]> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<EntryRow>(
          `select s.id, s.start_ts, s.tz_offset_min, s.kind, s.valence,
                  s.valence_classification, s.labels, s.associations, src.name as source_name
           from state_of_mind s
           join sources src on src.id = s.source_id
           where s.subject_id = $1
             and s.start_ts >= ($2::date::timestamp at time zone $4)
             and s.start_ts < ($3::date::timestamp at time zone $4)
           order by s.start_ts desc limit $5`,
          [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone, limit]
        )
      ).rows,
    [] as EntryRow[]
  );
  return rows.map((r) => ({
    id: r.id,
    startTs: r.start_ts,
    tzOffsetMin: r.tz_offset_min,
    kind: r.kind,
    valence: r.valence,
    valenceClassification: r.valence_classification,
    labels: r.labels ?? [],
    associations: r.associations ?? [],
    sourceName: r.source_name,
  }));
}

export interface TokenCount {
  token: string;
  count: number;
}

/**
 * How often each label / association was picked over the window. Counted in
 * SQL rather than in the page so a long window stays one round trip.
 */
export async function moodTokenCounts(
  ctx: SubjectContext,
  range: DayRange,
  column: 'labels' | 'associations',
  limit = 12
): Promise<TokenCount[]> {
  // `column` is not user input: it is one of the two literals of this union,
  // and the query is otherwise fully parameterised.
  const field = column === 'labels' ? 'labels' : 'associations';
  return untilMigrated(
    async () =>
      (
        await getDb().query<TokenCount>(
          `select token, count(*)::int as count
           from state_of_mind s, unnest(s.${field}) as token
           where s.subject_id = $1
             and s.start_ts >= ($2::date::timestamp at time zone $4)
             and s.start_ts < ($3::date::timestamp at time zone $4)
           group by token order by count desc, token limit $5`,
          [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone, limit]
        )
      ).rows,
    [] as TokenCount[]
  );
}

export interface MoodTotals {
  entries: number;
  firstDay: string | null;
  lastDay: string | null;
}

export async function moodTotals(ctx: SubjectContext): Promise<MoodTotals> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<{ entries: number; first_day: string | null; last_day: string | null }>(
          `select count(*)::int as entries,
                  (min(start_ts) at time zone $2)::date::text as first_day,
                  (max(start_ts) at time zone $2)::date::text as last_day
           from state_of_mind where subject_id = $1`,
          [ctx.subjectId, ctx.timezone]
        )
      ).rows,
    [] as Array<{ entries: number; first_day: string | null; last_day: string | null }>
  );
  const r = rows[0];
  return { entries: r?.entries ?? 0, firstDay: r?.first_day ?? null, lastDay: r?.last_day ?? null };
}

/** Share of each of Apple's seven valence regions over the window. */
export async function moodClassificationCounts(
  ctx: SubjectContext,
  range: DayRange
): Promise<Array<{ classification: number; count: number }>> {
  return untilMigrated(
    async () =>
      (
        await getDb().query<{ classification: number; count: number }>(
          `select valence_classification as classification, count(*)::int as count
           from state_of_mind
           where subject_id = $1 and valence_classification is not null
             and start_ts >= ($2::date::timestamp at time zone $4)
             and start_ts < ($3::date::timestamp at time zone $4)
           group by 1 order by 1`,
          [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone]
        )
      ).rows,
    [] as Array<{ classification: number; count: number }>
  );
}
