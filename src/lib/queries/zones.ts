// Heart rate zones (product phase 2, 2026-09-04: fitIQ's "Zone analysis" read
// through the charter). Five bands of the subject's maximum heart rate, at
// 50, 60, 70, 80 and 90 %: the common training vocabulary, stated as bpm
// bounds wherever it is used.
//
// The maximum is OBSERVED, not declared: the highest 99th percentile of any
// session's HR samples over the last 365 days, under a 220 bpm ceiling. A
// single spurious sample does not move it (a 255 bpm optical artefact sits in
// the real data, 2026-04-24), a sustained maximal effort does. The basis is
// stated next to every zone chart. A declared maximum (per-subject setting)
// can come later without changing the accounting below.
//
// Time in zone: each HR sample owns the interval to the next sample, capped
// at 60 s; a longer gap is unrecorded time, not time in the last zone seen.
import { withTransaction } from '@/lib/db';
import { cached } from './cache';
import type { SubjectContext } from './context';
import { getMetricType } from './metric-types';
import { getSubjectSettings } from './settings';
import { heavyRead } from './read';
import { addDays, type DayRange } from './time';

const HR = 'HKQuantityTypeIdentifierHeartRate';
/** Lower bound of Z1..Z5 as a fraction of the maximum. */
export const ZONE_FRACTIONS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
export const MAX_HR_CEILING = 220;
const MAX_GAP_S = 60;
const MAX_HR_TTL_MS = 24 * 3600 * 1000;

export interface MaxHrEstimate {
  bpm: number;
  /** First day of the observation window. */
  sinceDay: string;
  /** Sessions with HR samples that entered the estimate. */
  sessions: number;
}

export interface ZoneTime {
  zone: 1 | 2 | 3 | 4 | 5;
  fromBpm: number;
  /** Null for Z5: open upwards. */
  toBpm: number | null;
  seconds: number;
}

export interface ZoneBreakdown {
  zones: ZoneTime[];
  /** Recorded seconds under Z1 (below 50 %). */
  belowS: number;
  /** All recorded seconds, zones and below. */
  totalS: number;
}

export function zoneBounds(maxHr: number): Array<Pick<ZoneTime, 'zone' | 'fromBpm' | 'toBpm'>> {
  return ZONE_FRACTIONS.map((f, i) => ({
    zone: (i + 1) as ZoneTime['zone'],
    fromBpm: Math.round(maxHr * f),
    toBpm: i === ZONE_FRACTIONS.length - 1 ? null : Math.round(maxHr * ZONE_FRACTIONS[i + 1]),
  }));
}

/** Zone index 0..5 of a heart rate (0 = below Z1). */
function zoneOf(bpm: number, maxHr: number): number {
  const f = bpm / maxHr;
  let z = 0;
  for (const lower of ZONE_FRACTIONS) if (f >= lower) z += 1;
  return z;
}

function breakdown(secondsByZone: number[], maxHr: number): ZoneBreakdown {
  const bounds = zoneBounds(maxHr);
  const zones = bounds.map((b) => ({ ...b, seconds: secondsByZone[b.zone] ?? 0 }));
  const belowS = secondsByZone[0] ?? 0;
  return { zones, belowS, totalS: belowS + zones.reduce((a, z) => a + z.seconds, 0) };
}

/** Observed maximum, cached for a day per subject; null when no session carried HR. */
export async function estimatedMaxHr(ctx: SubjectContext, today: string): Promise<MaxHrEstimate | null> {
  return cached(`maxhr:${ctx.subjectId}:${today}`, MAX_HR_TTL_MS, async () => {
    const hr = await getMetricType(HR);
    const sinceDay = addDays(today, -365);
    interface Row {
      bpm: number | null;
      sessions: number;
    }
    const rows = await heavyRead<Row>(
      `with per_session as (
         select w.id, percentile_cont(0.99) within group (order by o.value) as p99
         from workouts w
         join observations o
           on o.subject_id = w.subject_id and o.type_id = $2
          and o.start_ts >= w.start_ts and o.start_ts < w.end_ts
          and o.value <= $4
         where w.subject_id = $1 and w.start_ts >= $3::timestamptz
         group by w.id
       )
       select max(p99)::float as bpm, count(*)::int as sessions from per_session`,
      [ctx.subjectId, hr.id, `${sinceDay}T00:00:00Z`, MAX_HR_CEILING]
    );
    const row = rows[0];
    if (!row || row.bpm === null) return null;
    return { bpm: Math.round(row.bpm), sinceDay, sessions: row.sessions };
  });
}

export interface MaxHrBasis {
  bpm: number;
  /** Declared by the subject (subject_settings) or observed in their sessions. */
  basis: 'declared' | 'observed';
  /** The observed estimate, also given next to a declared maximum for comparison. */
  observed: MaxHrEstimate | null;
}

/** The maximum the zones are cut from: declared when the subject set one, observed otherwise. */
export async function resolveMaxHr(ctx: SubjectContext, today: string): Promise<MaxHrBasis | null> {
  const [settings, observed] = await Promise.all([getSubjectSettings(ctx), estimatedMaxHr(ctx, today)]);
  if (settings.maxHrBpm !== null) return { bpm: settings.maxHrBpm, basis: 'declared', observed };
  return observed ? { bpm: observed.bpm, basis: 'observed', observed } : null;
}

/** Time in zones of one session from its HR samples (already fetched, sorted). */
export function zonesFromSamples(samples: Array<{ ts: Date; bpm: number }>, maxHr: number): ZoneBreakdown {
  const acc = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i + 1 < samples.length; i++) {
    const dt = Math.min(MAX_GAP_S, (samples[i + 1].ts.getTime() - samples[i].ts.getTime()) / 1000);
    if (dt <= 0) continue;
    acc[zoneOf(samples[i].bpm, maxHr)] += dt;
  }
  return breakdown(acc, maxHr);
}

/**
 * Time in zones over every session of a window (subject-local days), one
 * activity type or all.
 *
 * Reads the per-session rows of workout_hr_zones (migration 0008) and fills
 * whatever is missing on the way in. The walk over raw HR samples now happens
 * ONCE per session instead of once per view: it used to cost 0.8 s for six
 * months and 1.5 s for a year against a 500 ms budget, which is why callers
 * stopped at a quarter. The fill is a no-op as soon as the window is warm.
 *
 * The zone cuts depend on the maximum, so a row computed against another
 * maximum is stale and gets recomputed; that is what makes the cache safe
 * when the observed maximum moves or the subject declares one.
 */
export async function timeInZones(
  ctx: SubjectContext,
  range: DayRange,
  maxHr: number,
  activityType?: string
): Promise<ZoneBreakdown> {
  // The read needs no gap bound: the seconds are already split. Passing one
  // anyway is not harmless — Postgres refuses a bind with a parameter the
  // statement never names.
  const params: unknown[] = [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone, maxHr];
  let filter = '';
  if (activityType) {
    params.push(activityType);
    filter = `and w.activity_type = $${params.length}`;
  }
  interface Row {
    below_s: number;
    z1_s: number;
    z2_s: number;
    z3_s: number;
    z4_s: number;
    z5_s: number;
  }
  const rows = await withTransaction(async (client) => {
    // Same knobs as heavyRead: the fill is the heavy aggregate now, and it is
    // the one that used to spill the default work_mem.
    await client.query('set local jit = off');
    await client.query("set local work_mem = '32MB'");
    await client.query(
      `select workout_hr_zones_fill(
         $1,
         ($2::date::timestamp at time zone $4),
         ($3::date::timestamp at time zone $4),
         $5::smallint,
         $6::float
       )`,
      [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone, maxHr, MAX_GAP_S]
    );
    const res = await client.query<Row>(
      `select coalesce(sum(z.below_s), 0)::float as below_s,
              coalesce(sum(z.z1_s), 0)::float as z1_s,
              coalesce(sum(z.z2_s), 0)::float as z2_s,
              coalesce(sum(z.z3_s), 0)::float as z3_s,
              coalesce(sum(z.z4_s), 0)::float as z4_s,
              coalesce(sum(z.z5_s), 0)::float as z5_s
       from workout_hr_zones z
       join workouts w on w.id = z.workout_id
       where z.subject_id = $1
         and z.max_hr_bpm = $5::smallint
         and w.start_ts >= ($2::date::timestamp at time zone $4)
         and w.start_ts < ($3::date::timestamp at time zone $4)
         ${filter}`,
      params
    );
    return res.rows;
  });
  const r = rows[0];
  const acc = r
    ? [r.below_s, r.z1_s, r.z2_s, r.z3_s, r.z4_s, r.z5_s]
    : [0, 0, 0, 0, 0, 0];
  return breakdown(acc, maxHr);
}
