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
import { cached } from './cache';
import type { SubjectContext } from './context';
import { getMetricType } from './metric-types';
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
 * activity type or all. The join walks each session's HR samples: fine for a
 * month, a few hundred milliseconds for a year, so callers stop at a year.
 */
export async function timeInZones(
  ctx: SubjectContext,
  range: DayRange,
  maxHr: number,
  activityType?: string
): Promise<ZoneBreakdown> {
  const hr = await getMetricType(HR);
  const params: unknown[] = [ctx.subjectId, hr.id, range.fromDay, range.toDayExcl, ctx.timezone, maxHr, MAX_GAP_S];
  let filter = '';
  if (activityType) {
    params.push(activityType);
    filter = `and w.activity_type = $${params.length}`;
  }
  interface Row {
    zone: number;
    seconds: number;
  }
  const rows = await heavyRead<Row>(
    `with samples as (
       select o.value,
              least(
                extract(epoch from lead(o.start_ts) over (partition by w.id order by o.start_ts) - o.start_ts),
                $7::float
              ) as dt
       from workouts w
       join observations o
         on o.subject_id = w.subject_id and o.type_id = $2
        and o.start_ts >= w.start_ts and o.start_ts < w.end_ts
       where w.subject_id = $1
         and (w.start_ts at time zone $5)::date >= $3::date
         and (w.start_ts at time zone $5)::date < $4::date
         ${filter}
     )
     select width_bucket(value / $6::float, array[0.5, 0.6, 0.7, 0.8, 0.9]) as zone,
            sum(dt)::float as seconds
     from samples
     where dt is not null and dt > 0
     group by 1`,
    params
  );
  const acc = [0, 0, 0, 0, 0, 0];
  for (const r of rows) acc[Math.min(5, Math.max(0, r.zone))] += r.seconds;
  return breakdown(acc, maxHr);
}
