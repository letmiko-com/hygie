// Instance context: the admin's scope, deliberately disjoint from the
// SubjectContext (architecture §1, decision of 2026-09-28). For any live
// subject, an admin reads what running the instance needs: who the members
// are, which devices push, whether batches arrive or fail, and how much
// arrives per day IN TOTAL. Nothing in this file reads a measure table or the
// taxonomy, and nothing returns a metric type: which types a subject records
// is already a health fact (a menopause symptom, an ECG, a state of mind).
// The per-type keys of ingest_batches.counts are summed away in SQL and never
// selected; batch errors surface as code and step, never their message.
//
// The health read layer takes a SubjectContext and nothing else; this layer
// takes an InstanceContext and nothing else. Neither can be built from the
// other, so the boundary holds in the query layer, not in the screens.
import { getDb } from '@/lib/db';
import { getSessionUser } from './context';
import { todayInZone } from './time';

declare const instanceScope: unique symbol;

export interface InstanceContext {
  readonly userId: string;
  readonly locale: string;
  /** Brand: only getInstanceContext() produces one. */
  readonly [instanceScope]: true;
}

/** The signed-in account's admin scope, or null for anyone who is not an enabled admin. */
export async function getInstanceContext(): Promise<InstanceContext | null> {
  const user = await getSessionUser();
  if (!user?.isAdmin) return null;
  return { userId: user.userId, locale: user.locale } as InstanceContext;
}

export interface MemberAccount {
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface MemberSummary {
  subjectId: string;
  subjectName: string;
  /** IANA zone of the subject: cuts its days. */
  timezone: string;
  createdAt: Date;
  /** Enabled accounts holding a grant on the subject. */
  accounts: MemberAccount[];
  activeDevices: number;
  /** Oldest last push among active devices (a device that never sent counts from its pairing). */
  quietestSince: Date | null;
  lastReceivedAt: Date | null;
  /** The most recent batch ended in failure: what the member's Sync screen shows as an error. */
  lastBatchFailed: boolean;
  pendingBatches: number;
  failedBatches30d: number;
}

const FAILED_WINDOW_DAYS = 30;

/** Every live subject with its instance state, oldest first. */
export async function listMembers(ictx: InstanceContext): Promise<MemberSummary[]> {
  void ictx;
  interface Row {
    id: string;
    display_name: string;
    timezone: string;
    created_at: Date;
    accounts: MemberAccount[];
    active_devices: number;
    quietest_since: Date | null;
    last_received_at: Date | null;
    last_status: string | null;
    pending: number | null;
    failed_30d: number | null;
  }
  const { rows } = await getDb().query<Row>(
    `with batches as (
       select subject_id,
              max(received_at) as last_received_at,
              (array_agg(status order by received_at desc))[1] as last_status,
              count(*) filter (where status in ('received', 'validated'))::int as pending,
              count(*) filter (where status = 'failed'
                                 and received_at > now() - $1::int * interval '1 day')::int as failed_30d
       from ingest_batches
       group by subject_id
     )
     select s.id, s.display_name, s.timezone, s.created_at,
            coalesce((select json_agg(json_build_object(
                               'email', u.email, 'displayName', u.display_name, 'isAdmin', u.is_admin)
                             order by u.created_at)
                      from access_grants g
                      join users u on u.id = g.user_id and u.disabled_at is null
                      where g.subject_id = s.id), '[]'::json) as accounts,
            (select count(*)::int from devices d
              where d.subject_id = s.id and d.revoked_at is null) as active_devices,
            (select min(coalesce(d.last_seen_at, d.created_at)) from devices d
              where d.subject_id = s.id and d.revoked_at is null) as quietest_since,
            b.last_received_at, b.last_status, b.pending, b.failed_30d
     from subjects s
     left join batches b on b.subject_id = s.id
     where s.purge_state = 'live'
     order by s.created_at`,
    [FAILED_WINDOW_DAYS]
  );
  return rows.map((r) => ({
    subjectId: r.id,
    subjectName: r.display_name,
    timezone: r.timezone,
    createdAt: r.created_at,
    accounts: r.accounts,
    activeDevices: r.active_devices,
    quietestSince: r.quietest_since,
    lastReceivedAt: r.last_received_at,
    lastBatchFailed: r.last_status === 'failed',
    pendingBatches: r.pending ?? 0,
    failedBatches30d: r.failed_30d ?? 0,
  }));
}

/** Enabled admin accounts: they all receive the silence alerts. */
export async function listAdmins(ictx: InstanceContext): Promise<MemberAccount[]> {
  void ictx;
  const { rows } = await getDb().query<{ email: string; display_name: string }>(
    `select email, display_name from users
     where is_admin and disabled_at is null
     order by created_at`
  );
  return rows.map((r) => ({ email: r.email, displayName: r.display_name, isAdmin: true }));
}

export interface MemberDevice {
  id: string;
  name: string;
  platform: string | null;
  keyPrefix: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  pushes: number;
}

export interface MemberBatch {
  id: string;
  deviceName: string;
  receivedAt: Date;
  status: 'received' | 'validated' | 'normalized' | 'rollups_ready' | 'failed';
  formatVersion: string;
  bodyBytes: number;
  /** Points made visible by the batch, all types summed. */
  pointsIngested: number | null;
  attemptCount: number;
  errorCode: string | null;
  errorStep: string | null;
}

export interface MemberDayVolume {
  day: string;
  batches: number;
  bytes: number;
  /** All types summed; null when no batch landed that day (no data, not zero). */
  pointsIngested: number | null;
}

export interface MemberDetail {
  summary: MemberSummary;
  devices: MemberDevice[];
  batches: MemberBatch[];
  volumes: MemberDayVolume[];
}

/** One live subject's instance state, or null when it does not exist or is not live. */
export async function memberDetail(
  ictx: InstanceContext,
  subjectId: string,
  { days = 30, batchLimit = 15 } = {}
): Promise<MemberDetail | null> {
  const summary = (await listMembers(ictx)).find((m) => m.subjectId === subjectId);
  if (!summary) return null;
  const db = getDb();
  const tz = summary.timezone;

  interface DeviceRow {
    id: string;
    name: string;
    platform: string | null;
    key_prefix: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
    pushes: number;
  }
  interface BatchRow {
    id: string;
    device_name: string;
    received_at: Date;
    status: MemberBatch['status'];
    format_version: string;
    body_bytes: string;
    points: string | null;
    attempt_count: number;
    error_code: string | null;
    error_step: string | null;
  }
  interface VolumeRow {
    day: string;
    batches: number;
    bytes: string | null;
    points: string | null;
  }

  const [devices, batches, volumes] = await Promise.all([
    db.query<DeviceRow>(
      `select d.id, d.name, d.platform, d.key_prefix, d.created_at, d.last_seen_at, d.revoked_at,
              (select count(*)::int from ingest_batches b where b.device_id = d.id) as pushes
       from devices d
       where d.subject_id = $1
       order by d.revoked_at nulls first, d.created_at desc`,
      [subjectId]
    ),
    db.query<BatchRow>(
      `select b.id, d.name as device_name, b.received_at, b.status, b.format_version,
              b.body_bytes, b.attempt_count,
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
      [subjectId, batchLimit]
    ),
    db.query<VolumeRow>(
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
       select days.day::text as day, coalesce(agg.batches, 0) as batches, agg.bytes, agg.points
       from days left join agg using (day)
       order by days.day`,
      [subjectId, todayInZone(tz), days, tz]
    ),
  ]);

  return {
    summary,
    devices: devices.rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      keyPrefix: r.key_prefix,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      revokedAt: r.revoked_at,
      pushes: r.pushes,
    })),
    batches: batches.rows.map((r) => ({
      id: r.id,
      deviceName: r.device_name,
      receivedAt: r.received_at,
      status: r.status,
      formatVersion: r.format_version,
      bodyBytes: Number(r.body_bytes),
      pointsIngested: r.points === null ? null : Number(r.points),
      attemptCount: r.attempt_count,
      errorCode: r.error_code,
      errorStep: r.error_step,
    })),
    volumes: volumes.rows.map((r) => ({
      day: r.day,
      batches: r.batches,
      bytes: r.bytes === null ? 0 : Number(r.bytes),
      pointsIngested: r.points === null ? null : Number(r.points),
    })),
  };
}

/**
 * Revokes one device of a live subject (a lost phone). Creating a key stays
 * with the member: an admin never holds a key that writes into someone
 * else's subject. Returns false when nothing matched.
 */
export async function revokeMemberDevice(
  ictx: InstanceContext,
  subjectId: string,
  deviceId: string
): Promise<boolean> {
  void ictx;
  const res = await getDb().query(
    `update devices d set revoked_at = now()
     from subjects s
     where d.id = $1 and d.subject_id = $2 and d.revoked_at is null
       and s.id = d.subject_id and s.purge_state = 'live'`,
    [deviceId, subjectId]
  );
  return (res.rowCount ?? 0) > 0;
}
