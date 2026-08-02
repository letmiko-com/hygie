// Sleep nights. Convention: night_date is the WAKE date (measured on the HAE
// channel: a night starting 2026-07-31 22:22 UTC is labeled 2026-08-01), so
// the derived rule is local(start_ts) + 12h -> date.
// History comes from raw sleep_segments (XML) aggregated on the fly (18k
// rows, 13-35ms measured); nights already summarized by HAE (sleep_daily,
// channel 'hae') win over the derived aggregation for the same night.
// Several sources can record the same night (watch models overlapping at
// hardware transitions, 23 real cases): ONE winning source per night, watch
// first then longest asleep time — never merged, merging double-counts.
// Stage contract (metric_category_values, verified): 0 in_bed, 1 asleep
// unspecified, 2 awake, 3 core, 4 deep, 5 rem.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import type { DayRange } from './time';

export interface SleepNight {
  /** Wake date, local to the subject. */
  nightDate: string;
  channel: 'hae' | 'derived';
  sourceName: string | null;
  asleepS: number | null;
  coreS: number | null;
  deepS: number | null;
  remS: number | null;
  awakeS: number | null;
  inBedS: number | null;
  sleepStart: Date | null;
  sleepEnd: Date | null;
}

interface DerivedRow {
  night_date: string;
  source_name: string;
  asleep_s: number | null;
  core_s: number | null;
  deep_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  in_bed_s: number | null;
  sleep_start: Date | null;
  sleep_end: Date | null;
}

interface HaeRow {
  night_date: string;
  asleep_s: number | null;
  core_s: number | null;
  deep_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  in_bed_s: number | null;
  sleep_start: Date | null;
  sleep_end: Date | null;
}

/**
 * Nights whose wake date falls in [fromDay, toDayExcl), ordered by night.
 * Nights without any record are absent from the result (no data != zero);
 * callers align on days themselves when they need a dense axis.
 */
export async function sleepNights(ctx: SubjectContext, range: DayRange): Promise<SleepNight[]> {
  const db = getDb();
  const params = [ctx.subjectId, range.fromDay, range.toDayExcl, ctx.timezone];

  // Segments are fetched from one day before the range start: a night that
  // wakes on fromDay starts the previous local evening.
  const derived = db.query<DerivedRow>(
    `with seg as (
       select s.source_id, s.stage, s.start_ts, s.end_ts,
              ((s.start_ts at time zone $4) + interval '12 hours')::date as night_date,
              extract(epoch from s.end_ts - s.start_ts) as dur_s
       from sleep_segments s
       where s.subject_id = $1
         and s.start_ts >= (($2::date - 1)::timestamp at time zone $4)
         and s.start_ts < ($3::date::timestamp at time zone $4)
     ),
     by_source as (
       select night_date, source_id,
              sum(dur_s) filter (where stage in (1,3,4,5)) as asleep_s,
              sum(dur_s) filter (where stage = 3) as core_s,
              sum(dur_s) filter (where stage = 4) as deep_s,
              sum(dur_s) filter (where stage = 5) as rem_s,
              sum(dur_s) filter (where stage = 2) as awake_s,
              sum(dur_s) filter (where stage = 0) as in_bed_s,
              min(start_ts) filter (where stage in (1,3,4,5)) as sleep_start,
              max(end_ts) filter (where stage in (1,3,4,5)) as sleep_end
       from seg
       group by 1, 2
     )
     select distinct on (b.night_date)
            b.night_date::text as night_date, s.name as source_name,
            b.asleep_s::int, b.core_s::int, b.deep_s::int, b.rem_s::int,
            b.awake_s::int, b.in_bed_s::int, b.sleep_start, b.sleep_end
     from by_source b
     join sources s on s.id = b.source_id
     where b.night_date >= $2::date and b.night_date < $3::date
     order by b.night_date, (s.name ~* 'watch') desc, b.asleep_s desc nulls last`,
    params
  );

  const hae = db.query<HaeRow>(
    `select night_date::text as night_date, asleep_s, core_s, deep_s, rem_s,
            awake_s, in_bed_s, sleep_start, sleep_end
     from sleep_daily
     where subject_id = $1 and channel = 'hae'
       and night_date >= $2::date and night_date < $3::date`,
    [ctx.subjectId, range.fromDay, range.toDayExcl]
  );

  const [derivedRes, haeRes] = await Promise.all([derived, hae]);

  const byNight = new Map<string, SleepNight>();
  for (const r of derivedRes.rows) {
    byNight.set(r.night_date, {
      nightDate: r.night_date,
      channel: 'derived',
      sourceName: r.source_name,
      asleepS: r.asleep_s,
      coreS: r.core_s,
      deepS: r.deep_s,
      remS: r.rem_s,
      awakeS: r.awake_s,
      inBedS: r.in_bed_s,
      sleepStart: r.sleep_start,
      sleepEnd: r.sleep_end,
    });
  }
  for (const r of haeRes.rows) {
    // Measured on real payloads: HAE fills the stage columns and leaves
    // asleep at 0. The asleep total is the sum of stages in that case.
    const stagesSum =
      r.core_s === null && r.deep_s === null && r.rem_s === null
        ? null
        : (r.core_s ?? 0) + (r.deep_s ?? 0) + (r.rem_s ?? 0);
    const asleep = r.asleep_s !== null && r.asleep_s > 0 ? r.asleep_s : stagesSum;
    byNight.set(r.night_date, {
      nightDate: r.night_date,
      channel: 'hae',
      sourceName: null,
      asleepS: asleep,
      coreS: r.core_s,
      deepS: r.deep_s,
      remS: r.rem_s,
      awakeS: r.awake_s,
      inBedS: r.in_bed_s,
      sleepStart: r.sleep_start,
      sleepEnd: r.sleep_end,
    });
  }

  return [...byNight.values()].sort((a, b) => a.nightDate.localeCompare(b.nightDate));
}

export interface SleepTrend {
  /** Mean asleep seconds per recorded night; null when no night has data. */
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
}

function meanAsleep(nights: SleepNight[]): number | null {
  const values = nights.map((n) => n.asleepS).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Average asleep time vs the previous window (same pro rata logic as trends.ts). */
export async function sleepTrend(
  ctx: SubjectContext,
  range: DayRange,
  previous: DayRange
): Promise<SleepTrend> {
  const [cur, prev] = await Promise.all([
    sleepNights(ctx, range),
    sleepNights(ctx, previous),
  ]);
  const current = meanAsleep(cur);
  const previousMean = meanAsleep(prev);
  return {
    current,
    previous: previousMean,
    deltaPct:
      current === null || previousMean === null || previousMean === 0
        ? null
        : ((current - previousMean) / previousMean) * 100,
  };
}
