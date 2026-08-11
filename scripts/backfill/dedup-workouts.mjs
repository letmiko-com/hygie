// One-shot cleanup of strictly identical workouts (B4).
//
//   node scripts/backfill/dedup-workouts.mjs --subject <uuid> [--database-url <url>] [--apply]
//
// Apple's export contains some <Workout> elements twice (three known pairs in
// the 2024 history, verified in export.xml itself), and the import used to be
// faithful to the file. The importer now refuses the in-file duplicate
// (duplicate_workout_in_file); this script removes the pairs written before
// that guard existed.
//
// Strict identity only: every business column equal (activity type, source,
// start/end, timezone offset, indoor flag, duration, distance, energy,
// elevation, stats). Within a group one row is kept — the one carrying child
// rows (points, route, external ids) if exactly one does, else the first by
// id — and the others are deleted ONLY if they carry no child rows; a group
// where several rows carry children is reported and left alone. Dry-run by
// default; everything is counted and printed, nothing is removed silently.
// Workouts feed no rollup, so there is nothing to rebuild afterwards.
// Logs carry counts, types and dates only, never health values.
import pg from 'pg';

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    'usage: node scripts/backfill/dedup-workouts.mjs --subject <uuid> [--database-url <url>] [--apply]'
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let subjectId = null;
let databaseUrl = process.env.DATABASE_URL;
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--subject') subjectId = args[++i];
  else if (args[i] === '--database-url') databaseUrl = args[++i];
  else if (args[i] === '--apply') apply = true;
  else usage(`unknown argument: ${args[i]}`);
}
if (!subjectId) usage('--subject is required');
if (!databaseUrl) usage('DATABASE_URL or --database-url is required');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const subject = await client.query('select 1 from subjects where id = $1', [subjectId]);
  if (subject.rowCount === 0) throw new Error(`subject ${subjectId} not found`);

  const groups = await client.query(
    `select array_agg(id::text order by id::text) as ids,
            activity_type, min(start_ts)::date::text as day, count(*)::int as n
       from workouts
      where subject_id = $1
      group by activity_type, source_id, start_ts, end_ts, tz_offset_min,
               is_indoor, duration_s, distance_m, energy_kj, elevation_up_m, stats
     having count(*) > 1
      order by min(start_ts)`,
    [subjectId]
  );
  console.log(`${groups.rowCount} group(s) of strictly identical workouts`);

  let deleted = 0;
  if (apply) await client.query('begin');
  for (const g of groups.rows) {
    const children = await client.query(
      `select w.id::text as id,
              (select count(*) from workout_points p where p.workout_id = w.id)
            + (select count(*) from workout_route_points r where r.workout_id = w.id)
            + (select count(*) from workout_external_ids x where x.workout_id = w.id) as kids
         from workouts w
        where w.id = any($1::uuid[])
        order by w.id::text`,
      [g.ids]
    );
    const withKids = children.rows.filter((r) => Number(r.kids) > 0);
    if (withKids.length > 1) {
      console.warn(
        `SKIP ${g.activity_type} ${g.day}: ${g.n} identical rows but ${withKids.length} carry ` +
        `child rows — not strictly redundant, resolve by hand`
      );
      continue;
    }
    const keeper = withKids.length === 1 ? withKids[0].id : children.rows[0].id;
    const drop = children.rows.filter((r) => r.id !== keeper).map((r) => r.id);
    console.log(`${g.activity_type} ${g.day}: keep 1 of ${g.n}, drop ${drop.length}`);
    if (apply) {
      await client.query('delete from workouts where id = any($1::uuid[])', [drop]);
    }
    deleted += drop.length;
  }

  if (deleted === 0) {
    console.log('no redundant workout to remove');
    if (apply) await client.query('commit');
  } else if (!apply) {
    console.log(`DRY-RUN: ${deleted} workout(s) would be deleted; re-run with --apply`);
  } else {
    await client.query('commit');
    console.log(`deleted ${deleted} workout(s)`);
  }
} catch (err) {
  if (apply) await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end().catch(() => {});
}
