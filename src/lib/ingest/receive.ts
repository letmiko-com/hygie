// Ingestion receive path for POST /api/v1/ingest/hae.
// Contract (docs/architecture.md §3): device key checked BEFORE reading the body;
// applicative size cap; body streamed to disk (never parsed here); file written
// temp-name -> fsync -> atomic rename -> row insert; 200 {batch_id} only after both
// are durable. No payload bytes and no secrets ever reach the logs.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { getDb } from '@/lib/db';

export const HAE_FORMAT_VERSION = 'hae-v2';
export const HAE_ADAPTER_VERSION = '0.1.0';
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

export function getDataDir(): string {
  return process.env.HYGIE_DATA_DIR ?? '/data';
}

export function getIngestDir(): string {
  return join(getDataDir(), 'ingest');
}

function maxBodyBytes(): number {
  const raw = process.env.HYGIE_MAX_BODY_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

interface DeviceRow {
  id: string;
  subject_id: string;
  key_hash: Buffer;
  revoked_at: Date | null;
}

/**
 * Authenticates the device key against devices.key_hash (sha256), timing-safe.
 * Scans every device row and compares each hash so the response time does not
 * depend on whether or where a match occurs. Revoked devices never match.
 */
async function authenticateDevice(
  key: string
): Promise<{ deviceId: string; subjectId: string } | null> {
  const presented = createHash('sha256').update(key, 'utf8').digest();
  const { rows } = await getDb().query<DeviceRow>(
    'select id, subject_id, key_hash, revoked_at from devices'
  );
  let match: DeviceRow | null = null;
  for (const row of rows) {
    const stored = row.key_hash;
    const equal =
      stored.length === presented.length && timingSafeEqual(stored, presented);
    // No early exit: constant work over the whole table.
    if (equal && match === null) match = row;
  }
  if (match === null || match.revoked_at !== null) return null;
  return { deviceId: match.id, subjectId: match.subject_id };
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

class BodyTooLargeError extends Error {}

/**
 * Streams the request body to tmpPath, gzipping unless the wire bytes are already
 * gzip. Returns the sha256 and byte count of the body AS RECEIVED on the wire
 * (that is the replayable identity of the batch, independent of our storage form).
 */
async function streamBodyToFile(
  body: ReadableStream<Uint8Array>,
  tmpPath: string,
  cap: number
): Promise<{ sha256: Buffer; bytes: number; wireGzip: boolean }> {
  const hash = createHash('sha256');
  let bytes = 0;
  let wireGzip = false;
  let first = true;

  const fileStream = createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 });
  let sink: NodeJS.WritableStream = fileStream;
  let gzip: ReturnType<typeof createGzip> | null = null;

  const source = Readable.fromWeb(body as import('node:stream/web').ReadableStream);
  try {
    for await (const chunk of source) {
      const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (first) {
        first = false;
        wireGzip =
          buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1;
        if (!wireGzip) {
          gzip = createGzip({ level: 6 });
          gzip.pipe(fileStream);
          sink = gzip;
        }
      }
      bytes += buf.length;
      if (bytes > cap) throw new BodyTooLargeError();
      hash.update(buf);
      if (!sink.write(buf)) await once(sink, 'drain');
    }
    sink.end();
    await once(fileStream, 'close');
  } catch (err) {
    gzip?.destroy();
    fileStream.destroy();
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
  if (bytes === 0) {
    await unlink(tmpPath).catch(() => {});
    throw new Error('empty body');
  }
  return { sha256: hash.digest(), bytes, wireGzip };
}

/** fsync a file, then its containing directory (rename durability on Linux). */
async function fsyncFileAndDir(filePath: string, dirPath: string): Promise<void> {
  const fh = await open(filePath, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  const dh = await open(dirPath, 'r');
  try {
    await dh.sync();
  } finally {
    await dh.close();
  }
}

function parseUuidHeader(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

function parseBooleanHeader(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

export async function receiveHaeBatch(req: Request): Promise<Response> {
  // 1. Authentication first: never touch the body for an unknown key.
  const key = req.headers.get('x-hygie-device-key');
  if (!key) {
    console.warn(`[ingest] rejected: missing device key (ua=${(req.headers.get('user-agent') || '?').slice(0, 40)})`);
    return errorResponse(401, 'missing_device_key', 'X-Hygie-Device-Key header is required');
  }
  let device: { deviceId: string; subjectId: string } | null;
  try {
    device = await authenticateDevice(key);
  } catch (err) {
    console.error(
      `[ingest] device authentication failed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return errorResponse(500, 'internal_error', 'internal error');
  }
  if (device === null) {
    // Unknown and revoked keys are indistinguishable on purpose (no oracle).
    // Key prefix only: enough to tell "old capture token" from "typo in the real key".
    console.warn(`[ingest] rejected: unknown device key (prefix=${key.slice(0, 5)}…, ua=${(req.headers.get('user-agent') || '?').slice(0, 40)})`);
    return errorResponse(401, 'invalid_device_key', 'unknown or revoked device key');
  }

  // 2. Applicative size cap, checked on Content-Length then enforced while streaming.
  const cap = maxBodyBytes();
  const declaredLength = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > cap) {
    return errorResponse(413, 'payload_too_large', `body exceeds ${cap} bytes`);
  }
  if (req.body === null) {
    return errorResponse(400, 'empty_body', 'request body is required');
  }

  // 3. Stream to disk: temp name -> fsync -> atomic rename.
  const batchId = randomUUID();
  const ingestDir = getIngestDir();
  await mkdir(ingestDir, { recursive: true });
  const fileName = `${batchId}.json.gz`;
  const tmpPath = join(ingestDir, `${fileName}.tmp`);
  const finalPath = join(ingestDir, fileName);

  let streamed: { sha256: Buffer; bytes: number; wireGzip: boolean };
  try {
    streamed = await streamBodyToFile(req.body, tmpPath, cap);
    await fsyncFileAndDir(tmpPath, ingestDir);
    await rename(tmpPath, finalPath);
    await fsyncFileAndDir(finalPath, ingestDir);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    if (err instanceof BodyTooLargeError) {
      return errorResponse(413, 'payload_too_large', `body exceeds ${cap} bytes`);
    }
    if (err instanceof Error && err.message === 'empty body') {
      return errorResponse(400, 'empty_body', 'request body is empty');
    }
    console.error(
      `[ingest] body streaming failed for batch ${batchId}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return errorResponse(500, 'internal_error', 'internal error');
  }

  // 4. Row insert; 200 only after commit. raw_path is stored relative to
  // HYGIE_DATA_DIR so the volume can be remounted elsewhere.
  const rawPath = join('ingest', fileName);
  try {
    await getDb().query(
      `insert into ingest_batches
         (id, device_id, subject_id, automation_id, session_id, upload_complete,
          body_bytes, body_sha256, raw_path, purge_after, format_version, adapter_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               (now() + interval '30 days')::date, $10, $11)`,
      [
        batchId,
        device.deviceId,
        device.subjectId,
        parseUuidHeader(req.headers.get('automation-id')),
        parseUuidHeader(req.headers.get('session-id')),
        parseBooleanHeader(req.headers.get('upload-complete')),
        streamed.bytes,
        streamed.sha256,
        rawPath,
        HAE_FORMAT_VERSION,
        HAE_ADAPTER_VERSION,
      ]
    );
    // Best effort, outside the durability contract.
    getDb()
      .query('update devices set last_seen_at = now() where id = $1', [device.deviceId])
      .catch(() => {});
  } catch (err) {
    // The row is the source of truth: without it the file is an orphan that boot
    // reconciliation will sweep. Remove it eagerly anyway.
    await unlink(finalPath).catch(() => {});
    console.error(
      `[ingest] batch row insert failed for batch ${batchId}: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return errorResponse(500, 'internal_error', 'internal error');
  }

  console.log(`[ingest] batch ${batchId} received (${streamed.bytes} bytes)`);
  return Response.json({ batch_id: batchId }, { status: 200 });
}
