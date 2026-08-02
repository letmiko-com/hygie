// In-process ingestion worker (docs/architecture.md §3), started by Next
// instrumentation. Claim protocol: atomic claim with FOR UPDATE SKIP LOCKED and a
// 5-minute lease (locked_by/locked_until); states received -> validated ->
// normalized -> rollups_ready | failed; one transaction per step, status updated
// after the matching commit; attempt_count + exponential backoff carried by the
// lease; advisory lock per (subject, type) during normalization (taken inside the
// normalize transaction); no new claims after SIGTERM; boot-time reconciliation of
// orphan files and rows whose file is gone.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { getDb, withTransaction } from '@/lib/db';
import { getIngestDir } from '@/lib/ingest/receive';
import {
  BatchValidationError,
  normalizeHaePayload,
  readAndValidateBatchFile,
  resolveRawPath,
} from '@/lib/ingest/normalize-hae';

const LEASE = "interval '5 minutes'";
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 5;

interface ClaimedBatch {
  id: string;
  subject_id: string;
  device_id: string;
  status: 'received' | 'validated' | 'normalized';
  attempt_count: number;
  raw_path: string;
  body_sha256: Buffer;
}

interface WorkerState {
  started: boolean;
  stopping: boolean;
  wakeUp: (() => void) | null;
  done: Promise<void> | null;
}

// One loop per process, whatever module graph Next builds: the guard lives on
// globalThis, keyed by a registered symbol.
const STATE_KEY = Symbol.for('hygie.ingest.worker');

function state(): WorkerState {
  const g = globalThis as { [STATE_KEY]?: WorkerState };
  return (g[STATE_KEY] ??= { started: false, stopping: false, wakeUp: null, done: null });
}

function maxAttempts(): number {
  const n = Number(process.env.HYGIE_MAX_ATTEMPTS ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ATTEMPTS;
}

function pollMs(): number {
  const n = Number(process.env.HYGIE_WORKER_POLL_MS ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_MS;
}

/** Exponential backoff in seconds: 30s, 60s, 120s... capped at 30 minutes. */
function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 1800);
}

// ---------------------------------------------------------------------------
// Claim and step execution

async function claimNext(workerId: string): Promise<ClaimedBatch | null> {
  const { rows } = await getDb().query<ClaimedBatch>(
    `update ingest_batches b
     set locked_by = $1,
         locked_until = now() + ${LEASE},
         attempt_count = b.attempt_count + 1,
         started_at = coalesce(b.started_at, now())
     where b.id = (
       select id from ingest_batches
       where status in ('received', 'validated', 'normalized')
         and (locked_until is null or locked_until < now())
         and attempt_count < $2
       order by received_at
       limit 1
       for update skip locked
     )
     returning b.id, b.subject_id, b.device_id, b.status, b.attempt_count,
               b.raw_path, b.body_sha256`,
    [workerId, maxAttempts()]
  );
  return rows[0] ?? null;
}

async function setStatus(
  batchId: string,
  status: string,
  workerId: string,
  opts: { counts?: unknown; normalized?: boolean; finished?: boolean } = {}
): Promise<void> {
  await getDb().query(
    `update ingest_batches
     set status = $2, status_updated_at = now(), error = null,
         locked_until = now() + ${LEASE},
         counts = coalesce($4::jsonb, counts),
         normalized_at = case when $5 then now() else normalized_at end,
         finished_at = case when $6 then now() else finished_at end
     where id = $1 and locked_by = $3`,
    [
      batchId,
      status,
      workerId,
      opts.counts === undefined ? null : JSON.stringify(opts.counts),
      opts.normalized === true,
      opts.finished === true,
    ]
  );
}

async function releaseLease(batchId: string, workerId: string): Promise<void> {
  await getDb().query(
    'update ingest_batches set locked_by = null, locked_until = null where id = $1 and locked_by = $2',
    [batchId, workerId]
  );
}

async function markFailure(
  batch: ClaimedBatch,
  workerId: string,
  err: unknown
): Promise<void> {
  const code = err instanceof BatchValidationError ? err.code : 'step_failed';
  // Redacted error: code, message, step. Never payload content, never values.
  const message = err instanceof Error ? err.message.slice(0, 500) : 'unknown error';
  const permanent =
    batch.attempt_count >= maxAttempts() || err instanceof BatchValidationError;
  const backoff = backoffSeconds(batch.attempt_count);
  await getDb().query(
    `update ingest_batches
     set error = $2,
         status = case when $3 then 'failed' else status end,
         finished_at = case when $3 then now() else finished_at end,
         status_updated_at = now(),
         locked_by = null,
         locked_until = case when $3 then null else now() + make_interval(secs => $4) end
     where id = $1 and locked_by = $5`,
    [
      batch.id,
      JSON.stringify({ code, message, step: batch.status, attempt: batch.attempt_count }),
      permanent,
      backoff,
      workerId,
    ]
  );
  console.error(
    `[worker] batch ${batch.id} step ${batch.status} failed (${code}, attempt ${batch.attempt_count}${permanent ? ', giving up' : `, retry in ${backoff}s`})`
  );
}

/**
 * Runs the remaining steps of one claimed batch under its lease.
 * Each step commits its own transaction, then the status row is updated; a crash
 * in between simply replays the (idempotent) step after the lease expires.
 */
async function processBatch(batch: ClaimedBatch, workerId: string): Promise<void> {
  const s = state();
  let status: ClaimedBatch['status'] = batch.status;

  while (!s.stopping) {
    if (status === 'received') {
      // Step 1: validate (parse, checksum, shape) and record the observed range.
      const { declaredRange } = await readAndValidateBatchFile(
        batch.raw_path,
        batch.body_sha256
      );
      await getDb().query(
        `update ingest_batches
         set declared_range = case
               when $2::timestamptz is null then declared_range
               else tstzrange($2::timestamptz, $3::timestamptz, '[]')
             end
         where id = $1 and locked_by = $4`,
        [batch.id, declaredRange?.min ?? null, declaredRange?.max ?? null, workerId]
      );
      await setStatus(batch.id, 'validated', workerId);
      status = 'validated';
      console.log(`[worker] batch ${batch.id} validated`);
    } else if (status === 'validated') {
      // Step 2: normalize inside one transaction (advisory locks taken within).
      const { payload } = await readAndValidateBatchFile(batch.raw_path, batch.body_sha256);
      const counts = await withTransaction((client) =>
        normalizeHaePayload(
          client,
          { id: batch.id, subject_id: batch.subject_id, device_id: batch.device_id },
          payload
        )
      );
      await setStatus(batch.id, 'normalized', workerId, { counts, normalized: true });
      status = 'normalized';
      console.log(`[worker] batch ${batch.id} normalized`);
    } else {
      // Step 3: rollups. TODO(rollups): enqueue rollup_dirty_ranges from the batch's
      // declared_range and let the rollup builder consume them. No-op for now by
      // design: rollups are derived and rebuildable, never blocking ingestion.
      await setStatus(batch.id, 'rollups_ready', workerId, { finished: true });
      console.log(`[worker] batch ${batch.id} rollups_ready`);
      break;
    }
  }
  await releaseLease(batch.id, workerId);
}

// ---------------------------------------------------------------------------
// Boot reconciliation

const UUID_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json\.gz$/;
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Boot reconciliation.
 * - *.tmp older than an hour: incomplete writes whose client never got a 200 -> deleted.
 * - Batch files without a row: the insert never happened, the device will retry ->
 *   moved to ingest/orphaned/ (never deleted silently).
 * - received/validated rows whose file is gone: marked failed (raw_file_missing).
 */
async function reconcileAtBoot(): Promise<void> {
  const dir = getIngestDir();
  await mkdir(dir, { recursive: true });

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const fileIds = new Map<string, string>(); // batch id -> file name
  for (const name of names) {
    const full = join(dir, name);
    if (name.endsWith('.tmp')) {
      try {
        const st = await stat(full);
        if (Date.now() - st.mtimeMs > TMP_MAX_AGE_MS) {
          await unlink(full);
          console.log(`[worker] reconcile: removed stale temp file ${name}`);
        }
      } catch {
        // raced or unreadable: skip
      }
      continue;
    }
    const m = UUID_FILE_RE.exec(name);
    if (m) fileIds.set(m[1], name);
  }

  if (fileIds.size > 0) {
    const { rows } = await getDb().query<{ id: string }>(
      'select id from ingest_batches where id = any($1::uuid[])',
      [[...fileIds.keys()]]
    );
    const known = new Set(rows.map((r) => r.id));
    const orphanDir = join(dir, 'orphaned');
    for (const [id, name] of fileIds) {
      if (known.has(id)) continue;
      await mkdir(orphanDir, { recursive: true });
      await rename(join(dir, name), join(orphanDir, name)).catch(() => {});
      console.log(`[worker] reconcile: orphan file ${name} moved to orphaned/`);
    }
  }

  const pending = await getDb().query<{ id: string; raw_path: string }>(
    "select id, raw_path from ingest_batches where status in ('received', 'validated')"
  );
  for (const row of pending.rows) {
    try {
      await stat(resolveRawPath(row.raw_path));
    } catch {
      await getDb().query(
        `update ingest_batches
         set status = 'failed', status_updated_at = now(), finished_at = now(),
             locked_by = null, locked_until = null, error = $2
         where id = $1 and status in ('received', 'validated')`,
        [row.id, JSON.stringify({ code: 'raw_file_missing', message: 'raw body file missing at boot' })]
      );
      console.error(`[worker] reconcile: batch ${row.id} failed, raw file missing`);
    }
  }
}

// ---------------------------------------------------------------------------
// Loop and lifecycle

function sleep(ms: number, s: WorkerState): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.wakeUp = null;
      resolve();
    }, ms);
    timer.unref?.();
    // SIGTERM interrupts the wait so shutdown is immediate.
    s.wakeUp = () => {
      clearTimeout(timer);
      s.wakeUp = null;
      resolve();
    };
  });
}

async function runLoop(workerId: string): Promise<void> {
  const s = state();
  try {
    await reconcileAtBoot();
  } catch (err) {
    console.error(
      `[worker] boot reconciliation failed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
  console.log(`[worker] ingest worker ${workerId} started`);
  while (!s.stopping) {
    let claimed: ClaimedBatch | null = null;
    try {
      claimed = await claimNext(workerId);
      if (claimed) {
        try {
          await processBatch(claimed, workerId);
        } catch (err) {
          await markFailure(claimed, workerId, err);
        }
        continue; // drain the queue before sleeping
      }
    } catch (err) {
      console.error(
        `[worker] loop error: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
    await sleep(pollMs(), s);
  }
  console.log(`[worker] ingest worker ${workerId} stopped`);
}

/**
 * Starts the in-process worker loop. Idempotent: one loop per process, whatever
 * how many times instrumentation or tests call it. Disabled when
 * HYGIE_WORKER_DISABLED=1 (test harnesses drive the pipeline themselves).
 */
export function startIngestWorker(): void {
  const s = state();
  if (s.started) return;
  if (process.env.HYGIE_WORKER_DISABLED === '1') {
    console.log('[worker] ingest worker disabled by HYGIE_WORKER_DISABLED');
    return;
  }
  s.started = true;
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  const stop = () => {
    if (s.stopping) return;
    s.stopping = true; // no new claims; the current step finishes under its lease
    s.wakeUp?.();
    console.log('[worker] shutdown requested, finishing current step');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  s.done = runLoop(workerId).catch((err) => {
    console.error(
      `[worker] loop crashed: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    s.started = false;
  });
}

/** Requests a stop and waits for the loop to finish (test harnesses). */
export async function stopIngestWorker(): Promise<void> {
  const s = state();
  s.stopping = true;
  s.wakeUp?.();
  await s.done;
}
