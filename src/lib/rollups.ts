// Hourly rollups: invalidation queue and builder (docs/architecture.md §4).
//
// Rollups are derived and rebuildable, never the source of truth. Two rules keep
// them honest:
//
//   1. INVALIDATION IS EXACT AND TRANSACTIONAL. Whoever writes a source row
//      (observations, minute_stats, channel_cutovers) enqueues the UTC hours it
//      touched into rollup_dirty_ranges *inside the same transaction*. Committed
//      write <=> committed dirty range; a rolled back normalization leaves no
//      stale queue entry. The alternative (deriving the hours from the batch's
//      declared_range) would recompute hours nothing changed in, and would still
//      miss the hours a cutover invalidates outside that range.
//   2. NOTHING CLAIMS TO BE READY BEFORE IT IS. The ingestion worker drains the
//      ranges tagged with its batch id before moving the batch to 'rollups_ready'.
//      Ranges with a null batch_id (cutover moves, XML backfill, manual rebuild)
//      are drained when the worker is idle.
//
// The queue is transactional: a pass deletes the ranges it claims and rebuilds
// them in the same transaction, so a crash re-queues them. Draining is safe
// against concurrent writers without any extra lock: a range is only deleted
// once its producing transaction has committed, and READ COMMITTED then makes
// that producer's rows visible to the rebuild statement that follows.
// The rebuild itself lives in SQL (rollup_rebuild_range, migration 0002) so the
// worker and scripts/rebuild-rollups.mjs cannot drift apart.
import type pg from 'pg';
import { withTransaction } from '@/lib/db';

const HOUR_MS = 3_600_000;

/** Accumulates the UTC hours touched by a transaction, per metric type. */
export type DirtyHours = Map<number, Set<number>>; // type id -> hour start (epoch ms)

export interface DirtyRange {
  typeId: number;
  fromTs: Date;
  toTs: Date; // exclusive
}

export function markDirtyHour(hours: DirtyHours, typeId: number, ts: Date): void {
  const hour = Math.floor(ts.getTime() / HOUR_MS) * HOUR_MS;
  const set = hours.get(typeId) ?? new Set<number>();
  set.add(hour);
  hours.set(typeId, set);
}

/** Merges an hour set into the smallest list of contiguous half-open ranges. */
export function hourRuns(hours: Set<number>): Array<{ from: number; to: number }> {
  const sorted = [...hours].sort((a, b) => a - b);
  const runs: Array<{ from: number; to: number }> = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.to === h) last.to = h + HOUR_MS;
    else runs.push({ from: h, to: h + HOUR_MS });
  }
  return runs;
}

/**
 * Enqueues invalidation ranges. MUST be called inside the transaction that wrote
 * the source rows (the caller's client), never on a fresh connection.
 */
export async function enqueueDirtyRanges(
  client: pg.PoolClient,
  subjectId: string,
  batchId: string | null,
  hours: DirtyHours,
  extra: DirtyRange[] = []
): Promise<number> {
  const values: Array<{ typeId: number; from: Date; to: Date }> = [];
  for (const [typeId, set] of hours) {
    for (const run of hourRuns(set)) {
      values.push({ typeId, from: new Date(run.from), to: new Date(run.to) });
    }
  }
  for (const r of extra) {
    if (r.toTs > r.fromTs) values.push({ typeId: r.typeId, from: r.fromTs, to: r.toTs });
  }
  if (values.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    const params: unknown[] = [subjectId, batchId];
    const tuples = slice.map((v, j) => {
      params.push(v.typeId, v.from, v.to);
      const b = 2 + j * 3;
      return `($1, $${b + 1}::smallint, $${b + 2}::timestamptz, $${b + 3}::timestamptz, $2)`;
    });
    await client.query(
      `insert into rollup_dirty_ranges (subject_id, type_id, from_ts, to_ts, batch_id)
       values ${tuples.join(',')}`,
      params
    );
  }
  return values.length;
}

export interface DrainResult {
  ranges: number; // queue entries consumed
  hours: number; // rollup_hourly rows written
}

interface ClaimedRange {
  id: string;
  subject_id: string;
  type_id: number;
  from_ts: Date;
  to_ts: Date;
}

/**
 * Claims and rebuilds up to `limit` queued ranges in one transaction.
 * With `batchId`, only that batch's ranges are considered, which is what makes
 * the 'rollups_ready' status honest. Returns zero ranges when the queue (or the
 * batch's slice of it) is empty.
 */
export async function drainRollupQueue(
  opts: { batchId?: string | null; limit?: number } = {}
): Promise<DrainResult> {
  const limit = opts.limit ?? 100;
  const batchId = opts.batchId ?? null;
  return withTransaction(async (client) => {
    // Same knobs as the read layer: the rebuild is a heavy aggregate, JIT never
    // pays off at this volume and the default work_mem spills the GROUP BY.
    await client.query('set local jit = off');
    await client.query("set local work_mem = '32MB'");
    const { rows } = await client.query<ClaimedRange>(
      `with picked as (
         select id from rollup_dirty_ranges
         where ($1::uuid is null or batch_id = $1::uuid)
         order by id
         limit $2
         for update skip locked
       )
       delete from rollup_dirty_ranges d
       using picked
       where d.id = picked.id
       returning d.id::text as id, d.subject_id, d.type_id, d.from_ts, d.to_ts`,
      [batchId, limit]
    );
    if (rows.length === 0) return { ranges: 0, hours: 0 };
    // Stable (subject, type) order: overlapping rebuilds then take row locks in
    // the same order, so two workers can never deadlock on the same series.
    rows.sort(
      (a, b) =>
        (a.subject_id < b.subject_id ? -1 : a.subject_id > b.subject_id ? 1 : 0) ||
        a.type_id - b.type_id ||
        a.from_ts.getTime() - b.from_ts.getTime()
    );
    let hours = 0;
    for (const r of rows) {
      const res = await client.query<{ n: number }>(
        'select rollup_rebuild_range($1, $2::smallint, $3, $4) as n',
        [r.subject_id, r.type_id, r.from_ts, r.to_ts]
      );
      hours += res.rows[0]?.n ?? 0;
    }
    return { ranges: rows.length, hours };
  });
}
