// Member purge (docs/architecture.md §1): the background half of deleting a
// member. An admin first disables the member (src/lib/tombstones.ts cuts the
// access at once), then asks for the purge, which sets the subject to
// 'purging' and records it in the tombstone registry. This job, driven by the
// worker's idle turns, erases the subject table by table, one chunk per call,
// so it never holds a long transaction nor starves an incoming batch:
//
//   rollup queue, workout and audiogram children, measure tables, settings,
//   raw ingest bodies (file first, then the row stamp), batch rows, orphan
//   source names, then one final transaction: accounts, grants, devices, and
//   the subject row set to 'purged' with its name cleared.
//
// ON DELETE CASCADE is an integrity net, not the algorithm. The final
// transaction verifies that EVERY table carrying a subject_id is empty for the
// subject, including any table a later migration adds: a table this job does
// not know about stops the purge with an error instead of being skipped.
// Relaunchable at any point: each step deletes whatever is left.
import { unlink } from 'node:fs/promises';
import type pg from 'pg';
import { getDb, withTransaction } from '@/lib/db';
import { resolveRawPath } from '@/lib/ingest/normalize-hae';

const CHUNK = 5_000;
const FILE_CHUNK = 200;

const bySubject = (table: string) =>
  `delete from ${table} where ctid = any(array(
     select ctid from ${table} where subject_id = $1 limit $2))`;
const byParent = (table: string, parent: string, fk: string) =>
  `delete from ${table} where ctid = any(array(
     select t.ctid from ${table} t join ${parent} p on p.id = t.${fk}
     where p.subject_id = $1 limit $2))`;

// The rollup queue goes first so nothing rebuilds a subject being erased.
// Every table referencing ingest_batches comes before the batch rows, and
// observations before import_runs. Devices go in the final transaction, after
// minute_stats, channel_cutovers and ingest_batches, which reference them.
const TABLE_STEPS: Array<{ table: string; sql: string }> = [
  { table: 'rollup_dirty_ranges', sql: bySubject('rollup_dirty_ranges') },
  { table: 'workout_points', sql: byParent('workout_points', 'workouts', 'workout_id') },
  { table: 'workout_route_points', sql: byParent('workout_route_points', 'workouts', 'workout_id') },
  { table: 'workout_external_ids', sql: byParent('workout_external_ids', 'workouts', 'workout_id') },
  { table: 'workout_hr_zones', sql: bySubject('workout_hr_zones') },
  { table: 'workouts', sql: bySubject('workouts') },
  { table: 'audiogram_points', sql: byParent('audiogram_points', 'audiograms', 'audiogram_id') },
  { table: 'audiograms', sql: bySubject('audiograms') },
  { table: 'ecg_recordings', sql: bySubject('ecg_recordings') },
  { table: 'heartbeat_series', sql: bySubject('heartbeat_series') },
  { table: 'state_of_mind', sql: bySubject('state_of_mind') },
  { table: 'activity_summaries', sql: bySubject('activity_summaries') },
  { table: 'observations', sql: bySubject('observations') },
  { table: 'minute_stats', sql: bySubject('minute_stats') },
  { table: 'minute_conflicts', sql: bySubject('minute_conflicts') },
  { table: 'channel_cutovers', sql: bySubject('channel_cutovers') },
  { table: 'sleep_segments', sql: bySubject('sleep_segments') },
  { table: 'sleep_daily', sql: bySubject('sleep_daily') },
  { table: 'rollup_hourly', sql: bySubject('rollup_hourly') },
  { table: 'subject_metric_settings', sql: bySubject('subject_metric_settings') },
  { table: 'source_priorities', sql: bySubject('source_priorities') },
  { table: 'subject_settings', sql: bySubject('subject_settings') },
  { table: 'import_runs', sql: bySubject('import_runs') },
];
const BATCH_STEP = { table: 'ingest_batches', sql: bySubject('ingest_batches') };

/** Tables the final transaction empties itself, or that this job covers. */
const COVERED = new Set([...TABLE_STEPS.map((s) => s.table), BATCH_STEP.table, 'access_grants', 'devices']);

// A source row is a name ("Alex's Apple Watch"): once no row of any subject
// points to it, it goes. The used set is a handful of ids, aggregated per
// table, so the delete is one hashed lookup per source.
const SWEEP_SOURCES = `
  with used as (
    select source_id from observations group by source_id
    union select source_id from minute_stats group by source_id
    union select source_id from workouts group by source_id
    union select source_id from sleep_segments group by source_id
    union select source_id from activity_summaries group by source_id
    union select source_id from ecg_recordings group by source_id
    union select source_id from audiograms group by source_id
    union select source_id from heartbeat_series group by source_id
    union select source_id from state_of_mind group by source_id
    union select source_id from source_priorities group by source_id
  )
  delete from sources where id not in (select source_id from used)`;

/** Deletes the raw bodies of the subject's batches: file first, stamp after, like the rotation. */
async function purgeRawBodies(subjectId: string): Promise<number> {
  const db = getDb();
  const { rows } = await db.query<{ id: string; raw_path: string }>(
    `select id, raw_path from ingest_batches
     where subject_id = $1 and raw_purged_at is null
     limit ${FILE_CHUNK}`,
    [subjectId]
  );
  for (const row of rows) {
    try {
      await unlink(resolveRawPath(row.raw_path));
    } catch (err) {
      // A body already gone is done; any other failure stops the purge here,
      // to be retried: a subject is not purged while one of its files remains.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  if (rows.length > 0) {
    await db.query('update ingest_batches set raw_purged_at = now() where id = any($1::uuid[])', [
      rows.map((r) => r.id),
    ]);
  }
  return rows.length;
}

/** Every table carrying a subject_id, from the catalog: the purge cannot forget one added later. */
async function tablesWithSubjectRows(client: pg.PoolClient, subjectId: string): Promise<string[]> {
  const { rows: tables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.columns
     where table_schema = current_schema() and column_name = 'subject_id'
       and table_name not in ('access_grants', 'devices')`
  );
  const left: string[] = [];
  for (const { table_name } of tables) {
    const { rows } = await client.query<{ present: boolean }>(
      `select exists (select 1 from ${client.escapeIdentifier(table_name)} where subject_id = $1) as present`,
      [subjectId]
    );
    if (rows[0].present) left.push(table_name);
  }
  return left;
}

/**
 * The last transaction of a purge: accounts that hold no grant on another
 * subject, grants, devices, then the subject row itself, kept as 'purged'
 * with an empty name. Returns false when rows reappeared since the last pass
 * (a batch of another process committing late): the next turn deletes them.
 */
async function finalize(subjectId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const subject = await client.query(
      `select 1 from subjects where id = $1 and purge_state = 'purging' for update`,
      [subjectId]
    );
    if (subject.rows.length === 0) return true;

    const left = await tablesWithSubjectRows(client, subjectId);
    const unknown = left.filter((t) => !COVERED.has(t));
    if (unknown.length > 0) {
      throw new Error(`purge: table(s) not covered by the purge job still hold rows: ${unknown.join(', ')}`);
    }
    if (left.length > 0) return false;

    const { rows: accounts } = await client.query<{ id: string; email: string }>(
      `select u.id, u.email from users u
       join access_grants g on g.user_id = u.id and g.subject_id = $1
       where not u.is_admin
         and not exists (select 1 from access_grants o
                         join subjects s on s.id = o.subject_id and s.purge_state <> 'purged'
                         where o.user_id = u.id and o.subject_id <> $1)`,
      [subjectId]
    );
    await client.query('delete from access_grants where subject_id = $1', [subjectId]);
    if (accounts.length > 0) {
      await client.query('delete from auth_verification_tokens where identifier = any($1::citext[])', [
        accounts.map((a) => a.email),
      ]);
      // Sessions go with the account (on delete cascade).
      await client.query('delete from users where id = any($1::uuid[])', [accounts.map((a) => a.id)]);
    }
    await client.query('delete from devices where subject_id = $1', [subjectId]);
    await client.query(
      `update subjects set purge_state = 'purged', display_name = '' where id = $1`,
      [subjectId]
    );
    console.log(`[purge] subject ${subjectId} purged (${accounts.length} account(s) deleted)`);
    return true;
  });
}

/**
 * Runs one chunk of the oldest pending purge. Returns true when it did some
 * work (the worker loops again at once), false when there is nothing to do or
 * when it has to wait for a batch still leased by another process.
 */
export async function purgeNextChunk(): Promise<boolean> {
  const db = getDb();
  const { rows } = await db.query<{ id: string }>(
    `select id from subjects where purge_state = 'purging' order by created_at limit 1`
  );
  const subjectId = rows[0]?.id;
  if (!subjectId) return false;

  // The worker no longer claims batches of a subject being purged, but a
  // batch claimed before the purge started may still be in a process
  // overlapping this one during a redeploy: let its lease run out first.
  const leased = await db.query(
    `select 1 from ingest_batches where subject_id = $1 and locked_until > now() limit 1`,
    [subjectId]
  );
  if (leased.rows.length > 0) return false;

  for (const step of TABLE_STEPS) {
    const res = await db.query(step.sql, [subjectId, CHUNK]);
    if ((res.rowCount ?? 0) > 0) return true;
  }
  if ((await purgeRawBodies(subjectId)) > 0) return true;
  const batches = await db.query(BATCH_STEP.sql, [subjectId, CHUNK]);
  if ((batches.rowCount ?? 0) > 0) return true;
  const sources = await db.query(SWEEP_SOURCES);
  if ((sources.rowCount ?? 0) > 0) return true;

  return finalize(subjectId);
}
