// Device pairing: create (the raw key exists only in the creation response,
// shown once, stored as a sha256 hash), list with push counts, revoke
// (devices are never deleted: the ingest audit trail survives). Every entry
// point takes the SubjectContext: a device always belongs to the session's
// granted subject.
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db';
import type { SubjectContext } from '@/lib/queries/context';

const KEY_PREFIX_DISPLAY = 10;

export interface CreatedDevice {
  id: string;
  /** Shown once, never stored, never logged. */
  rawKey: string;
}

export async function createDevice(
  ctx: SubjectContext,
  name: string,
  platform: string | null
): Promise<CreatedDevice> {
  const rawKey = `hygk_${randomBytes(24).toString('base64url')}`;
  const keyHash = createHash('sha256').update(rawKey, 'utf8').digest();
  const { rows } = await getDb().query<{ id: string }>(
    `insert into devices (subject_id, name, platform, key_hash, key_prefix)
     values ($1, $2, $3, $4, $5) returning id`,
    [ctx.subjectId, name, platform, keyHash, rawKey.slice(0, KEY_PREFIX_DISPLAY)]
  );
  return { id: rows[0].id, rawKey };
}

/** Revokes within the subject scope; returns false when nothing matched. */
export async function revokeDevice(ctx: SubjectContext, deviceId: string): Promise<boolean> {
  const res = await getDb().query(
    `update devices set revoked_at = now()
     where id = $1 and subject_id = $2 and revoked_at is null`,
    [deviceId, ctx.subjectId]
  );
  return (res.rowCount ?? 0) > 0;
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: string | null;
  keyPrefix: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  pushes: number;
}

export async function listDevices(ctx: SubjectContext): Promise<DeviceRow[]> {
  interface Row {
    id: string;
    name: string;
    platform: string | null;
    key_prefix: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
    pushes: number;
  }
  const { rows } = await getDb().query<Row>(
    `select d.id, d.name, d.platform, d.key_prefix, d.created_at, d.last_seen_at, d.revoked_at,
            (select count(*)::int from ingest_batches b where b.device_id = d.id) as pushes
     from devices d
     where d.subject_id = $1
     order by d.revoked_at nulls first, d.created_at desc`,
    [ctx.subjectId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
    pushes: r.pushes,
  }));
}
