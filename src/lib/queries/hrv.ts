// Heart rate variability read from the beat-to-beat series (heartbeat_series,
// migration 0007). Distinct from the HeartRateVariabilitySDNN marker on
// /markers, which is Apple's own 60 s SDNN published as an ordinary quantity:
// here the intervals themselves are stored, so RMSSD and pNN50 exist and the
// tachogram of one measurement can be drawn.
//
// Days are computed in the subject's zone like everywhere else, and every
// read tolerates the table's absence until 0007 is applied.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { untilMigrated } from './optional';
import type { DayRange } from './time';

export interface HrvDay {
  day: string;
  /** Mean over the day's series; null keeps "no data != zero" intact. */
  rmssdMs: number | null;
  sdnnMs: number | null;
  meanHrBpm: number | null;
  pnn50Pct: number | null;
  seriesCount: number;
}

export interface HeartbeatSeriesItem {
  id: string;
  startTs: Date;
  tzOffsetMin: number;
  beatCount: number;
  gapCount: number;
  durationS: number | null;
  meanHrBpm: number | null;
  sdnnMs: number | null;
  rmssdMs: number | null;
  pnn50Pct: number | null;
  sourceName: string;
}

export interface HeartbeatSeriesDetail extends HeartbeatSeriesItem {
  endTs: Date | null;
  meanRrMs: number | null;
  /** Delay to the next beat in ms; null where a gap preceded that beat. */
  intervalsMs: Array<number | null>;
}

interface DayRow {
  day: string;
  rmssd_ms: string | number | null;
  sdnn_ms: string | number | null;
  mean_hr_bpm: string | number | null;
  pnn50_pct: string | number | null;
  series_count: number;
}

const num = (v: string | number | null): number | null =>
  v === null ? null : typeof v === 'number' ? v : Number(v);

/**
 * One point per day that holds at least one series. Missing days are absent
 * rather than zero: the caller decides how to draw a hole.
 */
export async function hrvDailySeries(ctx: SubjectContext, range: DayRange): Promise<HrvDay[]> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<DayRow>(
          `select (start_ts at time zone $4)::date::text as day,
                  avg(rmssd_ms) as rmssd_ms,
                  avg(sdnn_ms) as sdnn_ms,
                  avg(mean_hr_bpm) as mean_hr_bpm,
                  avg(pnn50_pct) as pnn50_pct,
                  count(*)::int as series_count
           from heartbeat_series
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
    rmssdMs: num(r.rmssd_ms),
    sdnnMs: num(r.sdnn_ms),
    meanHrBpm: num(r.mean_hr_bpm),
    pnn50Pct: num(r.pnn50_pct),
    seriesCount: r.series_count,
  }));
}

interface ListRow {
  id: string;
  start_ts: Date;
  tz_offset_min: number;
  beat_count: number;
  gap_count: number;
  duration_s: number | null;
  mean_hr_bpm: number | null;
  sdnn_ms: number | null;
  rmssd_ms: number | null;
  pnn50_pct: number | null;
  source_name: string;
}

function mapItem(r: ListRow): HeartbeatSeriesItem {
  return {
    id: r.id,
    startTs: r.start_ts,
    tzOffsetMin: r.tz_offset_min,
    beatCount: r.beat_count,
    gapCount: r.gap_count,
    durationS: r.duration_s,
    meanHrBpm: r.mean_hr_bpm,
    sdnnMs: r.sdnn_ms,
    rmssdMs: r.rmssd_ms,
    pnn50Pct: r.pnn50_pct,
    sourceName: r.source_name,
  };
}

const ITEM_COLUMNS = `h.id, h.start_ts, h.tz_offset_min, h.beat_count, h.gap_count,
        h.duration_s, h.mean_hr_bpm, h.sdnn_ms, h.rmssd_ms, h.pnn50_pct, s.name as source_name`;

/** The window's series, newest first. The intervals are never loaded here. */
export async function listHeartbeatSeries(
  ctx: SubjectContext,
  range: DayRange,
  limit = 200
): Promise<HeartbeatSeriesItem[]> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<ListRow>(
          `select ${ITEM_COLUMNS}
           from heartbeat_series h
           join sources s on s.id = h.source_id
           where h.subject_id = $1
             and h.start_ts >= ($2::date::timestamp at time zone $4)
             and h.start_ts < ($3::date::timestamp at time zone $4)
           order by h.start_ts desc limit $5`,
          [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone, limit]
        )
      ).rows,
    [] as ListRow[]
  );
  return rows.map(mapItem);
}

export interface HrvTotals {
  series: number;
  beats: number;
  firstDay: string | null;
  lastDay: string | null;
}

/** All-time counts: what the header states and what an empty window explains. */
export async function hrvTotals(ctx: SubjectContext): Promise<HrvTotals> {
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<{
          series: number;
          beats: string | number | null;
          first_day: string | null;
          last_day: string | null;
        }>(
          `select count(*)::int as series,
                  coalesce(sum(beat_count), 0) as beats,
                  (min(start_ts) at time zone $2)::date::text as first_day,
                  (max(start_ts) at time zone $2)::date::text as last_day
           from heartbeat_series where subject_id = $1`,
          [ctx.subjectId, ctx.timezone]
        )
      ).rows,
    [] as Array<{ series: number; beats: string | number | null; first_day: string | null; last_day: string | null }>
  );
  const r = rows[0];
  return {
    series: r?.series ?? 0,
    beats: num(r?.beats ?? null) ?? 0,
    firstDay: r?.first_day ?? null,
    lastDay: r?.last_day ?? null,
  };
}

// A path segment is whatever the reader typed: /hrv/not-a-uuid must read as
// "no such series", not as a 500 from Postgres refusing the cast (22P02).
// The guard sits here rather than in the page so no caller can forget it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getHeartbeatSeries(
  ctx: SubjectContext,
  id: string
): Promise<HeartbeatSeriesDetail | null> {
  if (!UUID_RE.test(id)) return null;
  interface Row extends ListRow {
    end_ts: Date | null;
    mean_rr_ms: number | null;
    intervals_ms: Array<number | null>;
  }
  const rows = await untilMigrated(
    async () =>
      (
        await getDb().query<Row>(
          `select ${ITEM_COLUMNS}, h.end_ts, h.mean_rr_ms, h.intervals_ms
           from heartbeat_series h
           join sources s on s.id = h.source_id
           where h.subject_id = $1 and h.id = $2`,
          [ctx.subjectId, id]
        )
      ).rows,
    [] as Row[]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...mapItem(r),
    endTs: r.end_ts,
    meanRrMs: r.mean_rr_ms,
    intervalsMs: r.intervals_ms ?? [],
  };
}
