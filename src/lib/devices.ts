// Device pairing: create (the raw key exists only in the creation response,
// shown once, stored as a sha256 hash), list with push counts, revoke
// (recorded in the tombstone registry, so a restore cannot bring the key
// back; a device row is deleted only by its member's purge, the ingest audit
// trail survives revocation). Every entry point takes the SubjectContext: a
// device always belongs to the session's granted subject.
import { createHash, randomBytes } from 'node:crypto';
import { getDb, withTransaction } from '@/lib/db';
import type { SubjectContext } from '@/lib/queries/context';
import { staleAfterMs } from '@/lib/silence';
import { appendTombstones } from '@/lib/tombstones';

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
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select 1 from devices where id = $1 and subject_id = $2 and revoked_at is null for update`,
      [deviceId, ctx.subjectId]
    );
    if (rows.length === 0) return false;
    await appendTombstones(client, [{ kind: 'device_revoked', device: deviceId, subject: ctx.subjectId }]);
    await client.query('update devices set revoked_at = now() where id = $1', [deviceId]);
    return true;
  });
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

export interface SilentDevice {
  id: string;
  name: string;
  lastSeenAt: Date | null;
}

/**
 * Active devices of the subject past the silence threshold, longest silence
 * first: the dashboard banner. Same rule as the alert email (a device that
 * never sent counts from its pairing), read from last_seen_at only, so it
 * works whether or not migration 0009 has run.
 */
export async function silentDevices(ctx: SubjectContext): Promise<SilentDevice[]> {
  const { rows } = await getDb().query<{ id: string; name: string; last_seen_at: Date | null }>(
    `select id, name, last_seen_at
     from devices
     where subject_id = $1
       and revoked_at is null
       and coalesce(last_seen_at, created_at) < now() - $2::double precision * interval '1 millisecond'
     order by coalesce(last_seen_at, created_at)`,
    [ctx.subjectId, staleAfterMs()]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, lastSeenAt: r.last_seen_at }));
}
