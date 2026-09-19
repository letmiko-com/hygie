// GET /api/v1/device/status: what the server made of ONE device's batches, for
// the diagnostic screen of Hygie Sync (docs/native-format.md, "Device status").
//
// The ingest endpoint answers 200 as soon as a batch is durable on disk, before
// the worker normalizes it, so the app can never learn from the ack whether
// its samples were understood (unit_mismatch, unknown type, failed batch). This
// read-only companion answers exactly that, scoped to the calling device.
// Contract: same authentication as ingestion (device key in a header, checked
// first, unknown and revoked keys indistinguishable); no health value ever
// appears in the response, only counters, timestamps and type names; no side
// effect, in particular last_seen_at is NOT touched (it means "sent data").
import { getDb } from '@/lib/db';
import { authenticateDevice } from './receive';
import { NATIVE_FORMAT_VERSION } from './normalize-native';

export const DEVICE_STATUS_FORMAT = 'hygie-device-status/1';
/** Native batches older than this are out of the refusal counters (and out of
 *  the raw retention, architecture §3.4): the screen shows recent trouble. */
export const REFUSED_WINDOW_DAYS = 30;
const RECENT_FAILURES = 5;
const VISIBLE = `('normalized', 'rollups_ready')`;

export interface DeviceStatus {
  format: typeof DEVICE_STATUS_FORMAT;
  server_time: string;
  device: {
    name: string;
    created_at: string;
    /** Last batch received from this device, whatever its state. */
    last_seen_at: string | null;
  };
  taxonomy: {
    /** Every HealthKit identifier the server can ingest, sorted. */
    types: string[];
  };
  batches: {
    last_received_at: string | null;
    /** Last time data of this device became visible (status >= normalized). */
    last_visible_at: string | null;
    pending: number;
    failed: number;
    /** Newest failed batches, code and step only: never a raw message. */
    recent_failures: { received_at: string; code: string | null; step: string | null }[];
  };
  refused_samples: {
    window_days: number;
    /** Samples refused for a wrong unit, per wire type name. */
    unit_mismatch: Record<string, number>;
    /** Samples of a type this server does not know, per wire type name. */
    unknown_type: Record<string, number>;
  };
}

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

export async function deviceStatus(deviceId: string): Promise<DeviceStatus | null> {
  const db = getDb();
  interface DeviceRow {
    name: string;
    created_at: Date;
    last_seen_at: Date | null;
  }
  interface AggRow {
    last_received_at: Date | null;
    last_visible_at: Date | null;
    pending: number;
    failed: number;
  }
  interface FailureRow {
    received_at: Date;
    code: string | null;
    step: string | null;
  }
  interface RefusedRow {
    type: string;
    unit_mismatch: string;
    unknown_type: string;
  }
  const [device, agg, failures, refused, types] = await Promise.all([
    db.query<DeviceRow>('select name, created_at, last_seen_at from devices where id = $1', [
      deviceId,
    ]),
    db.query<AggRow>(
      `select max(received_at) as last_received_at,
              max(normalized_at) filter (where status in ${VISIBLE}) as last_visible_at,
              count(*) filter (where status in ('received', 'validated'))::int as pending,
              count(*) filter (where status = 'failed')::int as failed
       from ingest_batches where device_id = $1`,
      [deviceId]
    ),
    db.query<FailureRow>(
      `select received_at, error->>'code' as code, error->>'step' as step
       from ingest_batches
       where device_id = $1 and status = 'failed'
       order by received_at desc limit $2`,
      [deviceId, RECENT_FAILURES]
    ),
    // counts->'metrics' is keyed by the wire type name; a batch not yet
    // normalized has no counts and simply contributes no row.
    db.query<RefusedRow>(
      `select e.key as type,
              sum(coalesce((e.value->>'unit_mismatch')::bigint, 0)) as unit_mismatch,
              sum(coalesce((e.value->>'skipped_unknown_type')::bigint, 0)) as unknown_type
       from ingest_batches b
       cross join lateral jsonb_each(b.counts->'metrics') e
       where b.device_id = $1
         and b.format_version = $2
         and b.received_at >= now() - make_interval(days => $3)
       group by 1
       having sum(coalesce((e.value->>'unit_mismatch')::bigint, 0)) > 0
           or sum(coalesce((e.value->>'skipped_unknown_type')::bigint, 0)) > 0
       order by 1`,
      [deviceId, NATIVE_FORMAT_VERSION, REFUSED_WINDOW_DAYS]
    ),
    db.query<{ hk_identifier: string }>('select hk_identifier from metric_types where supported'),
  ]);
  const d = device.rows[0];
  if (!d) return null;
  const a = agg.rows[0];
  const unitMismatch: Record<string, number> = {};
  const unknownType: Record<string, number> = {};
  for (const r of refused.rows) {
    const mismatch = Number(r.unit_mismatch);
    const unknown = Number(r.unknown_type);
    if (mismatch > 0) unitMismatch[r.type] = mismatch;
    if (unknown > 0) unknownType[r.type] = unknown;
  }
  return {
    format: DEVICE_STATUS_FORMAT,
    server_time: new Date().toISOString(),
    device: {
      name: d.name,
      created_at: d.created_at.toISOString(),
      last_seen_at: iso(d.last_seen_at),
    },
    // Sorted here, in code-unit order, so the list does not depend on the
    // collation of whichever Postgres a self-hoster runs.
    taxonomy: { types: types.rows.map((r) => r.hk_identifier).sort() },
    batches: {
      last_received_at: iso(a?.last_received_at ?? null),
      last_visible_at: iso(a?.last_visible_at ?? null),
      pending: a?.pending ?? 0,
      failed: a?.failed ?? 0,
      recent_failures: failures.rows.map((r) => ({
        received_at: r.received_at.toISOString(),
        code: r.code,
        step: r.step,
      })),
    },
    refused_samples: {
      window_days: REFUSED_WINDOW_DAYS,
      unit_mismatch: unitMismatch,
      unknown_type: unknownType,
    },
  };
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** The HTTP shell: authentication first, same codes as ingestion, then the read. */
export async function deviceStatusResponse(req: Request): Promise<Response> {
  const key = req.headers.get('x-hygie-device-key');
  if (!key) {
    return errorResponse(401, 'missing_device_key', 'X-Hygie-Device-Key header is required');
  }
  let device: { deviceId: string; subjectId: string } | null;
  try {
    device = await authenticateDevice(key);
  } catch (err) {
    console.error(
      `[device-status] device authentication failed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return errorResponse(500, 'internal_error', 'internal error');
  }
  if (device === null) {
    // Key prefix only, like ingestion: enough to tell an old token from a typo.
    console.warn(`[device-status] rejected: unknown device key (prefix=${key.slice(0, 5)}…)`);
    return errorResponse(401, 'invalid_device_key', 'unknown or revoked device key');
  }
  try {
    const status = await deviceStatus(device.deviceId);
    if (status === null) {
      return errorResponse(401, 'invalid_device_key', 'unknown or revoked device key');
    }
    return Response.json(status, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(
      `[device-status] read failed for device ${device.deviceId}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return errorResponse(500, 'internal_error', 'internal error');
  }
}
