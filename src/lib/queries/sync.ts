// Sync status reads. "Received" and "visible" are different facts
// (architecture §3.5): a batch is visible once status >= 'normalized' —
// never key on 'rollups_ready', the rollup step is currently a no-op.
// Errors surfaced to the UI carry code and step only, never raw messages
// (no health values or payload fragments can leak through them).
import { getDb } from '@/lib/db';
import { cached } from './cache';
import type { SubjectContext } from './context';
import { heavyRead } from './read';
import { todayInZone } from './time';

const VISIBLE = `('normalized', 'rollups_ready')`;

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string | null;
  keyPrefix: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export interface SyncOverview {
  devices: DeviceInfo[];
  /** Last time any batch arrived, whatever its state. */
  lastReceivedAt: Date | null;
  /** Last time ingested data became visible (status >= normalized). */
  lastVisibleAt: Date | null;
  pendingBatches: number;
  failedBatches: number;
}

export async function syncOverview(ctx: SubjectContext): Promise<SyncOverview> {
  const db = getDb();
  interface DeviceRow {
    id: string;
    name: string;
    platform: string | null;
    key_prefix: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
  }
  interface AggRow {
    last_received_at: Date | null;
    last_visible_at: Date | null;
    pending: number;
    failed: number;
  }
  const [devices, agg] = await Promise.all([
    db.query<DeviceRow>(
      `select id, name, platform, key_prefix, created_at, last_seen_at, revoked_at
       from devices where subject_id = $1
       order by revoked_at nulls first, created_at`,
      [ctx.subjectId]
    ),
    db.query<AggRow>(
      `select max(received_at) as last_received_at,
              max(normalized_at) filter (where status in ${VISIBLE}) as last_visible_at,
              count(*) filter (where status in ('received', 'validated'))::int as pending,
              count(*) filter (where status = 'failed')::int as failed
       from ingest_batches where subject_id = $1`,
      [ctx.subjectId]
    ),
  ]);
  const a = agg.rows[0];
  return {
    devices: devices.rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      keyPrefix: r.key_prefix,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      revokedAt: r.revoked_at,
    })),
    lastReceivedAt: a?.last_received_at ?? null,
    lastVisibleAt: a?.last_visible_at ?? null,
    pendingBatches: a?.pending ?? 0,
    failedBatches: a?.failed ?? 0,
  };
}

export interface BatchInfo {
  id: string;
  deviceName: string;
  receivedAt: Date;
  status: 'received' | 'validated' | 'normalized' | 'rollups_ready' | 'failed';
  visible: boolean;
  attemptCount: number;
  bodyBytes: number;
  /** Points made visible by this batch (inserted raw + minute + daily rows). */
  pointsIngested: number | null;
  errorCode: string | null;
  errorStep: string | null;
}

export async function recentBatches(ctx: SubjectContext, limit = 20): Promise<BatchInfo[]> {
  interface Row {
    id: string;
    device_name: string;
    received_at: Date;
    status: BatchInfo['status'];
    attempt_count: number;
    body_bytes: string;
    points: string | null;
    error_code: string | null;
    error_step: string | null;
  }
  const { rows } = await getDb().query<Row>(
    `select b.id, d.name as device_name, b.received_at, b.status, b.attempt_count,
            b.body_bytes,
            (select sum(coalesce((v->>'inserted')::bigint, 0)
                      + coalesce((v->>'minute_inserted')::bigint, 0)
                      + coalesce((v->>'daily_upserted')::bigint, 0))
             from jsonb_each(b.counts->'metrics') e(k, v)) as points,
            b.error->>'code' as error_code,
            b.error->>'step' as error_step
     from ingest_batches b
     join devices d on d.id = b.device_id
     where b.subject_id = $1
     order by b.received_at desc
     limit $2`,
    [ctx.subjectId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.device_name,
    receivedAt: r.received_at,
    status: r.status,
    visible: r.status === 'normalized' || r.status === 'rollups_ready',
    attemptCount: r.attempt_count,
    bodyBytes: Number(r.body_bytes),
    pointsIngested: r.points === null ? null : Number(r.points),
    errorCode: r.error_code,
    errorStep: r.error_step,
  }));
}

export interface DayVolume {
  day: string;
  batches: number;
  bytes: number;
  /** Null when no batch landed that day (no data, not zero). */
  pointsIngested: number | null;
}

/** Ingested volume per local day over the last `days` days, dense day axis. */
export async function ingestVolumesByDay(ctx: SubjectContext, days = 30): Promise<DayVolume[]> {
  interface Row {
    day: string;
    batches: number;
    bytes: string | null;
    points: string | null;
  }
  const rows = await heavyRead<Row>(
    `with days as (
       select d::date as day
       from generate_series($2::date - ($3::int - 1), $2::date, interval '1 day') d
     ),
     agg as (
       select (b.received_at at time zone $4)::date as day,
              count(*)::int as batches,
              sum(b.body_bytes) as bytes,
              sum((select sum(coalesce((v->>'inserted')::bigint, 0)
                           + coalesce((v->>'minute_inserted')::bigint, 0)
                           + coalesce((v->>'daily_upserted')::bigint, 0))
                   from jsonb_each(b.counts->'metrics') e(k, v))) as points
       from ingest_batches b
       where b.subject_id = $1
         and b.received_at >= (($2::date - ($3::int - 1))::timestamp at time zone $4)
       group by 1
     )
     select days.day::text as day, coalesce(agg.batches, 0) as batches,
            agg.bytes, agg.points
     from days left join agg using (day)
     order by days.day`,
    [ctx.subjectId, todayInZone(ctx.timezone), days, ctx.timezone]
  );
  return rows.map((r) => ({
    day: r.day,
    batches: r.batches,
    bytes: r.bytes === null ? 0 : Number(r.bytes),
    pointsIngested: r.points === null ? null : Number(r.points),
  }));
}

export interface DataTotals {
  /** Table-level estimate (reltuples): exact count costs 400ms for a cosmetic figure. */
  observationsApprox: number;
  minuteStats: number;
  workouts: number;
  sleepSegments: number;
  sleepNights: number;
  typesWithData: number;
  firstDay: string | null;
  lastDay: string | null;
}

export async function dataTotals(ctx: SubjectContext): Promise<DataTotals> {
  const key = `totals:${ctx.subjectId}:${todayInZone(ctx.timezone)}`;
  return cached(key, 6 * 60 * 60_000, async () => {
    interface Row {
      observations_approx: string;
      minute_stats: number;
      workouts: number;
      sleep_segments: number;
      sleep_nights: number;
      types_with_data: number;
      first_day: string | null;
      last_day: string | null;
    }
    // Coverage bounds probe the composite index once per type (~100 probes,
    // ms) instead of a full scan: min/max on start_ts alone cannot use it.
    const rows = await heavyRead<Row>(
      `with per_type as (
         select t.id,
                (select min(o.start_ts) from observations o
                 where o.subject_id = $1 and o.type_id = t.id) as min_ts,
                (select max(o.start_ts) from observations o
                 where o.subject_id = $1 and o.type_id = t.id) as max_ts
         from metric_types t
       ),
       bounds as (
         select min(min_ts) as min_ts, max(max_ts) as max_ts,
                count(*) filter (where min_ts is not null)::int as types_with_data
         from per_type
       )
       select (select reltuples::bigint from pg_class where relname = 'observations') as observations_approx,
              (select count(*)::int from minute_stats where subject_id = $1) as minute_stats,
              (select count(*)::int from workouts where subject_id = $1) as workouts,
              (select count(*)::int from sleep_segments where subject_id = $1) as sleep_segments,
              (select count(*)::int from sleep_daily where subject_id = $1) as sleep_nights,
              b.types_with_data,
              (b.min_ts at time zone $2)::date::text as first_day,
              (b.max_ts at time zone $2)::date::text as last_day
       from bounds b`,
      [ctx.subjectId, ctx.timezone]
    );
    const r = rows[0];
    return {
      observationsApprox: Number(r.observations_approx),
      minuteStats: r.minute_stats,
      workouts: r.workouts,
      sleepSegments: r.sleep_segments,
      sleepNights: r.sleep_nights,
      typesWithData: r.types_with_data,
      firstDay: r.first_day,
      lastDay: r.last_day,
    };
  });
}

export interface TypeCount {
  hkIdentifier: string;
  count: number;
  sharePct: number;
}

/**
 * Per-type observation counts. This is the one full index sweep of the sync
 * screen (~6.5M entries): cached per local day, first visitor pays it once.
 */
export async function topTypes(ctx: SubjectContext, limit = 8): Promise<TypeCount[]> {
  const key = `toptypes:${ctx.subjectId}:${todayInZone(ctx.timezone)}`;
  const all = await cached(key, 24 * 60 * 60_000, async () => {
    interface Row {
      hk_identifier: string;
      n: string;
    }
    return heavyRead<Row>(
      `select t.hk_identifier, count(*) as n
       from observations o join metric_types t on t.id = o.type_id
       where o.subject_id = $1
       group by 1 order by n desc`,
      [ctx.subjectId]
    );
  });
  const total = all.reduce((acc, r) => acc + Number(r.n), 0);
  return all.slice(0, limit).map((r) => ({
    hkIdentifier: r.hk_identifier,
    count: Number(r.n),
    sharePct: total > 0 ? (Number(r.n) / total) * 100 : 0,
  }));
}
