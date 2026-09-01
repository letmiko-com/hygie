// Moves the minute-channel authority of a subject's cutovers to another device.
//
//   node scripts/cutover.mjs --device <name> [--subject <uuid>] [--types <hk1,hk2,...>] [--yes]
//   node scripts/cutover.mjs --device-id <uuid>                [--types <hk1,hk2,...>] [--yes]
//                            [--database-url <url>]
//
// WHEN TO RUN IT: after replacing the companion device (new iPhone, Health Auto
// Export replaced by Hygie Sync, ...). Exactly one device is authoritative for the
// cumulative types per (subject, type), recorded on channel_cutovers.device_id
// (architecture.md §2). The cutover is bootstrapped by the FIRST device ever seen
// and never moves on its own, so a replacement device is non-authoritative forever:
// every minute it sends lands in minute_conflicts ("never adopted, never lost") and
// nothing is written to minute_stats. That is the 2026-08-14 incident: two days of
// silent gap, fixed by hand with an UPDATE. This script is that UPDATE, with the
// checks an operator at 23:00 forgets.
//
// What it does: one transaction, `update channel_cutovers set device_id = <new>`
// for every cutover of the device's subject (or the --types subset). What it does
// NOT do, deliberately:
//   * touch cutover_ts. Only the timestamp enters the truth rules (read layer and
//     rollup_rebuild_range): the device column is a write permission. Moving the
//     authority alone therefore invalidates no rollup, and `npm run rollups` is not
//     needed afterwards. Moving cutover_ts is a data decision (which channel is the
//     truth for the moved range), out of scope here: do it by hand, then rebuild.
//   * rewrite minute_stats.device_id on existing rows (provenance, kept as written).
//   * promote minute_conflicts recorded from the new device while it was not
//     authoritative. Their count is reported so you know data is waiting; the app
//     re-emits recent minutes on its own, older gaps are a backfill matter.
//
// Dry run by default: prints the plan (before → after) and writes nothing until
// --yes. Output carries device names, type identifiers, timestamps and counts only,
// never health values.
import pg from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/cutover.mjs --device <name> [--subject <uuid>] [--types <hk1,hk2,...>] [--yes]\n' +
      '       node scripts/cutover.mjs --device-id <uuid> [--types <hk1,hk2,...>] [--yes]\n' +
      '       [--database-url <url>]'
  );
  process.exit(2);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
let deviceName = null;
let deviceId = null;
let subjectId = null;
let types = null;
let yes = false;
let databaseUrl = process.env.DATABASE_URL;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--device') deviceName = args[++i];
  else if (args[i] === '--device-id') deviceId = args[++i];
  else if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--types') types = (args[++i] ?? '').split(',').filter(Boolean);
  else if (args[i] === '--yes') yes = true;
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else usage(`unexpected argument: ${args[i]}`);
}
if ((deviceName === null) === (deviceId === null)) usage('give exactly one of --device or --device-id');
if (deviceName !== null && deviceName.trim().length === 0) usage('--device needs a name');
if (deviceId !== null && !UUID_RE.test(deviceId)) usage('--device-id must be a uuid');
if (subjectId !== null && !UUID_RE.test(subjectId)) usage('--subject must be a uuid');
if (subjectId !== null && deviceId !== null) usage('--subject only applies to --device (a device id is already unique)');
if (types !== null && types.length === 0) usage('--types needs a comma-separated list');
if (!databaseUrl) usage('DATABASE_URL not set and --database-url not given');

const iso = (d) => d.toISOString().replace('.000Z', 'Z');
const pad = (s, n) => String(s).padEnd(n);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // 1. Resolve the target device. A name is an operator-chosen label (up to 80
  //    chars, homonyms allowed across subjects), so ambiguity is an error, never
  //    a guess.
  const DEVICE_SELECT = `
    select d.id, d.name, d.platform, d.subject_id, d.created_at, d.last_seen_at, d.revoked_at,
           s.display_name as subject_name, s.purge_state
    from devices d
    join subjects s on s.id = d.subject_id`;
  const { rows: candidates } =
    deviceId !== null
      ? await client.query(`${DEVICE_SELECT} where d.id = $1`, [deviceId])
      : await client.query(
          `${DEVICE_SELECT} where d.name = $1 and ($2::uuid is null or d.subject_id = $2)
           order by d.created_at`,
          [deviceName, subjectId]
        );

  if (candidates.length === 0) {
    if (deviceId !== null) fail(`device ${deviceId} does not exist`);
    // Help the operator past a typo without guessing for them.
    const { rows: near } = await client.query(
      `select d.name, s.display_name as subject_name from devices d
       join subjects s on s.id = d.subject_id
       where lower(d.name) = lower($1) and ($2::uuid is null or d.subject_id = $2)
       order by d.created_at`,
      [deviceName, subjectId]
    );
    const scope = subjectId !== null ? ` for subject ${subjectId}` : '';
    if (near.length > 0) {
      fail(
        `no device named "${deviceName}"${scope} (names are case-sensitive). Close matches:\n` +
          near.map((r) => `  "${r.name}" (subject: ${r.subject_name})`).join('\n')
      );
    }
    fail(`no device named "${deviceName}"${scope}`);
  }
  if (candidates.length > 1) {
    fail(
      `"${deviceName}" names ${candidates.length} devices; pick one with --device-id <uuid>` +
        (subjectId === null ? ' (or narrow with --subject <uuid>)' : '') +
        ':\n' +
        candidates
          .map(
            (d) =>
              `  ${d.id}  subject: ${d.subject_name}  platform: ${d.platform ?? '-'}  ` +
              `created: ${iso(d.created_at)}${d.revoked_at ? '  REVOKED' : ''}`
          )
          .join('\n')
    );
  }
  const target = candidates[0];

  // 2. Refuse what must never become an authority.
  if (target.revoked_at !== null) {
    fail(`device "${target.name}" (${target.id}) was revoked at ${iso(target.revoked_at)}: refusing to make it authoritative`);
  }
  if (target.purge_state !== 'live') {
    fail(`subject "${target.subject_name}" is ${target.purge_state}: refusing to touch its cutovers`);
  }

  console.log(`target device : "${target.name}" (${target.id})`);
  console.log(`subject       : "${target.subject_name}" (${target.subject_id})`);
  console.log(
    `last seen     : ${target.last_seen_at ? iso(target.last_seen_at) : 'never (pairing done, no batch received yet: fine, the authority just waits for it)'}`
  );

  // 3. The plan: every cutover of that subject, split by current authority.
  const { rows: cutovers } = await client.query(
    `select c.type_id, mt.hk_identifier, c.cutover_ts, c.device_id,
            d.name as device_name, d.revoked_at as device_revoked_at
     from channel_cutovers c
     join metric_types mt on mt.id = c.type_id
     join devices d on d.id = c.device_id
     where c.subject_id = $1 and ($2::text[] is null or mt.hk_identifier = any($2::text[]))
     order by mt.hk_identifier`,
    [target.subject_id, types]
  );
  if (types !== null) {
    const seen = new Set(cutovers.map((c) => c.hk_identifier));
    const missing = types.filter((t) => !seen.has(t));
    if (missing.length > 0) {
      // Not an error: a type with no cutover yet is bootstrapped by the first
      // device that sends it, which will now be the new one.
      console.log(`note          : no cutover yet for ${missing.join(', ')} (nothing to move there)`);
    }
  }
  const toMove = cutovers.filter((c) => c.device_id !== target.id);
  const already = cutovers.filter((c) => c.device_id === target.id);

  // Minutes this device sent while it was not authoritative: reported, not promoted.
  const { rows: conflicts } = await client.query(
    `select mt.hk_identifier, count(*)::int as n,
            min(mc.minute_ts) as first_ts, max(mc.minute_ts) as last_ts
     from minute_conflicts mc
     join metric_types mt on mt.id = mc.type_id
     where mc.subject_id = $1 and mc.device_id = $2
     group by mt.hk_identifier
     order by mt.hk_identifier`,
    [target.subject_id, target.id]
  );

  console.log('');
  if (cutovers.length === 0) {
    console.log('no cutover for this subject' + (types !== null ? ' and these types' : '') + ': nothing to do');
    process.exit(0);
  }
  const w = Math.max(...[...cutovers, ...conflicts].map((c) => c.hk_identifier.length), 4);
  console.log(`${pad('type', w)}  ${pad('cutover_ts (UTC)', 20)}  authority`);
  for (const c of cutovers) {
    const from = `"${c.device_name}"${c.device_revoked_at ? ' (revoked)' : ''}`;
    const line =
      c.device_id === target.id ? `${from}  = already` : `${from}  -> "${target.name}"`;
    console.log(`${pad(c.hk_identifier, w)}  ${pad(iso(c.cutover_ts), 20)}  ${line}`);
  }
  console.log('');
  console.log(`${toMove.length} cutover(s) to move, ${already.length} already on the target device`);
  if (conflicts.length > 0) {
    const total = conflicts.reduce((s, r) => s + r.n, 0);
    console.log(
      `${total} minute(s) from this device sit in minute_conflicts (not promoted by this script):`
    );
    for (const r of conflicts) {
      console.log(`  ${pad(r.hk_identifier, w)}  ${r.n} minute(s), ${iso(r.first_ts)} -> ${iso(r.last_ts)}`);
    }
  }

  if (toMove.length === 0) {
    console.log('nothing to do');
    process.exit(0);
  }
  if (!yes) {
    console.log('dry run: nothing written. Re-run with --yes to apply.');
    process.exit(0);
  }

  // 4. Apply: one transaction, exactly the rows shown above. A row count that
  //    differs from the plan means someone changed the table meanwhile: roll back
  //    and let the operator look again rather than apply a plan they never saw.
  await client.query('begin');
  try {
    const res = await client.query(
      `update channel_cutovers set device_id = $1
       where subject_id = $2 and type_id = any($3::smallint[]) and device_id <> $1`,
      [target.id, target.subject_id, toMove.map((c) => c.type_id)]
    );
    if (res.rowCount !== toMove.length) {
      throw new Error(
        `expected to move ${toMove.length} cutover(s), the update matched ${res.rowCount}: the table changed under us`
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
  console.log(
    `moved ${toMove.length} cutover(s) to "${target.name}". cutover_ts untouched, so no rollup to rebuild.`
  );
} finally {
  await client.end();
}
