// Tombstone registry (docs/architecture.md §1): the revocations a restore must
// not undo. A database restored from a dump taken before a member was
// disabled or purged, or before a device key was revoked, would serve them
// again. The registry lives OUTSIDE the database, as an append-only JSON Lines
// file on the app's data volume (HYGIE_DATA_DIR/tombstones.jsonl), so a
// restore of Postgres leaves it intact; the worker re-applies it at boot and
// in its hourly maintenance. Losing the data volume loses the registry: that
// is the documented limit of this design (decision of 2026-10-11).
//
// Write order: the line is appended and fsynced BEFORE the database change it
// records, inside the same transaction and under one advisory lock. A crash in
// between leaves a line the database does not reflect yet, and the next
// re-application completes it: the registry is the intent, the database
// converges to it. The lock serializes writers with the re-application, so a
// re-application can never replay an older state over a newer one.
//
// Lines carry ids and timestamps only: no name, no address, no health fact.
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { withTransaction } from '@/lib/db';
import { getDataDir } from '@/lib/ingest/receive';

// Single-key advisory locks: 727701 is the migration runner, 727702 the admin
// bootstrap. Normalization uses the two-key form, a separate key space.
const REGISTRY_LOCK = 727703;

export type Tombstone =
  | { kind: 'device_revoked'; device: string; subject: string }
  | { kind: 'subject_disabled' | 'subject_enabled' | 'subject_purged'; subject: string };

type Entry = Tombstone & { v: 1; at: string };

export function registryPath(): string {
  return join(getDataDir(), 'tombstones.jsonl');
}

/**
 * Takes the registry lock for the rest of the transaction. Every writer of a
 * revocation holds it from before its append to its commit.
 */
export async function lockRegistry(client: pg.PoolClient): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1)', [REGISTRY_LOCK]);
}

/**
 * Appends the events and fsyncs them, under the registry lock. Call it inside
 * the transaction that applies them, before applying: a failed write throws
 * and the transaction rolls back, so no revocation exists without its line.
 */
export async function appendTombstones(client: pg.PoolClient, events: Tombstone[]): Promise<void> {
  if (events.length === 0) return;
  await lockRegistry(client);
  // The first write may come before the worker's first re-application: the
  // file is then seeded here, from the state before this change.
  if (!(await registryExists())) await seedRegistry(client);
  await writeEntries(events);
}

async function registryExists(): Promise<boolean> {
  try {
    await access(registryPath());
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Appends and fsyncs; creates the file, even for no event. The caller holds the lock. */
async function writeEntries(events: Tombstone[]): Promise<void> {
  const at = new Date().toISOString();
  let lines = events.map((e) => JSON.stringify({ v: 1, at, ...e } satisfies Entry) + '\n').join('');
  await mkdir(getDataDir(), { recursive: true });
  const file = await open(registryPath(), 'a+', 0o600);
  try {
    // A torn last line (a crash mid-append) must not swallow the next event:
    // start on a fresh line whenever the file does not end with one.
    const { size } = await file.stat();
    if (size > 0 && lines !== '') {
      const last = Buffer.alloc(1);
      await file.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) lines = '\n' + lines;
    }
    await file.appendFile(lines, 'utf8');
    await file.datasync();
  } finally {
    await file.close();
  }
}

/**
 * Creates the registry from the database when the file does not exist yet:
 * the first start of a release that has it, or a fresh volume. Revocations
 * made before then would otherwise be undone by a restore of an older dump.
 * Records what the database holds now: revoked keys, disabled subjects, and
 * subjects being purged or purged. The caller holds the lock.
 */
async function seedRegistry(client: pg.PoolClient): Promise<number> {
  const devices = await client.query<{ id: string; subject_id: string }>(
    'select id, subject_id from devices where revoked_at is not null order by revoked_at'
  );
  const subjects = await client.query<{ id: string; purge_state: string }>(
    `select id, purge_state from subjects where purge_state <> 'live' order by created_at`
  );
  const events: Tombstone[] = [
    ...devices.rows.map((d) => ({ kind: 'device_revoked' as const, device: d.id, subject: d.subject_id })),
    ...subjects.rows.map((s) => ({
      kind: s.purge_state === 'revoked' ? ('subject_disabled' as const) : ('subject_purged' as const),
      subject: s.id,
    })),
  ];
  await writeEntries(events);
  return events.length;
}

async function readRegistry(): Promise<{ entries: Entry[]; unreadable: number } | null> {
  let text: string;
  try {
    text = await readFile(registryPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const entries: Entry[] = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e = JSON.parse(line) as Entry;
      if (e.v === 1 && typeof e.kind === 'string' && typeof e.subject === 'string') entries.push(e);
      else unreadable++;
    } catch {
      // A torn last line: the process died mid-append, before the commit of
      // the change it described. Nothing to re-apply.
      unreadable++;
    }
  }
  return { entries, unreadable };
}

/**
 * Cuts a subject off: state set, its accounts disabled (unless an account
 * still holds a grant on another live subject), their sessions and pending
 * sign-in links dropped, its devices revoked. Data becomes unreachable at
 * once; the grant rows stay, so re-enabling restores exactly the access that
 * existed. Returns the ids of the subjects that changed state.
 */
export async function cutOffSubjects(
  client: pg.PoolClient,
  subjectIds: string[],
  to: 'revoked' | 'purging'
): Promise<string[]> {
  if (subjectIds.length === 0) return [];
  const from = to === 'revoked' ? ['live'] : ['live', 'revoked'];
  const { rows } = await client.query<{ id: string }>(
    `update subjects set purge_state = $2
     where id = any($1::uuid[]) and purge_state = any($3::text[])
     returning id`,
    [subjectIds, to, from]
  );
  const accounts = await client.query<{ id: string; email: string }>(
    `update users u set disabled_at = now()
     where u.id in (select g.user_id from access_grants g where g.subject_id = any($1::uuid[]))
       and u.disabled_at is null
       and not u.is_admin
       and not exists (select 1 from access_grants o
                       join subjects s on s.id = o.subject_id and s.purge_state = 'live'
                       where o.user_id = u.id)
     returning u.id, u.email`,
    [subjectIds]
  );
  if (accounts.rows.length > 0) {
    await client.query('delete from auth_sessions where user_id = any($1::uuid[])', [
      accounts.rows.map((a) => a.id),
    ]);
    await client.query('delete from auth_verification_tokens where identifier = any($1::citext[])', [
      accounts.rows.map((a) => a.email),
    ]);
  }
  await client.query(
    `update devices set revoked_at = now()
     where subject_id = any($1::uuid[]) and revoked_at is null`,
    [subjectIds]
  );
  return rows.map((r) => r.id);
}

/** Gives a disabled subject its access back: state live, its accounts enabled. Devices stay revoked. */
export async function restoreSubjects(client: pg.PoolClient, subjectIds: string[]): Promise<string[]> {
  if (subjectIds.length === 0) return [];
  const { rows } = await client.query<{ id: string }>(
    `update subjects set purge_state = 'live'
     where id = any($1::uuid[]) and purge_state = 'revoked'
     returning id`,
    [subjectIds]
  );
  await client.query(
    `update users set disabled_at = null
     where id in (select user_id from access_grants where subject_id = any($1::uuid[]))
       and disabled_at is not null and not is_admin`,
    [rows.map((r) => r.id)]
  );
  return rows.map((r) => r.id);
}

export interface Reapplied {
  /** Entries written from the database because the file did not exist; 0 otherwise. */
  seeded: number;
  devices: number;
  disabled: number;
  enabled: number;
  purging: number;
  unreadable: number;
}

/**
 * Brings the database in line with the registry: every revoked device stays
 * revoked, and each subject ends in the state of its last event (a purge is
 * final: what follows it is ignored). A purged subject is put back to
 * 'purging' and the purge job (src/lib/purge.ts) erases it again. Idempotent:
 * on a database already in line, it changes nothing. A missing file is first
 * created from the database (seedRegistry).
 */
export async function reapplyTombstones(): Promise<Reapplied> {
  return withTransaction(async (client) => {
    await lockRegistry(client);
    let seeded = 0;
    let registry = await readRegistry();
    if (registry === null) {
      seeded = await seedRegistry(client);
      registry = (await readRegistry()) ?? { entries: [], unreadable: 0 };
    }
    const { entries, unreadable } = registry;
    const devices = new Set<string>();
    const last = new Map<string, Tombstone['kind']>();
    for (const e of entries) {
      if (e.kind === 'device_revoked') {
        if (typeof e.device === 'string') devices.add(e.device);
        continue;
      }
      if (last.get(e.subject) === 'subject_purged') continue;
      last.set(e.subject, e.kind);
    }
    const withState = (kind: Tombstone['kind']) => [...last].filter(([, k]) => k === kind).map(([s]) => s);

    const revoked = await client.query(
      `update devices set revoked_at = now()
       where id = any($1::uuid[]) and revoked_at is null`,
      [[...devices]]
    );
    const purging = await cutOffSubjects(client, withState('subject_purged'), 'purging');
    const disabled = await cutOffSubjects(client, withState('subject_disabled'), 'revoked');
    const enabled = await restoreSubjects(client, withState('subject_enabled'));
    return {
      seeded,
      devices: revoked.rowCount ?? 0,
      disabled: disabled.length,
      enabled: enabled.length,
      purging: purging.length,
      unreadable,
    };
  });
}
