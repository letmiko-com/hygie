// Minimal forward-only SQL migration runner. Never called automatically at boot:
// run explicitly (locally, or as a Railway pre-deploy command when a release needs it).
// Files: db/migrations/NNNN_name.sql, applied in lexical order inside one transaction
// each, recorded in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const dir = join(process.cwd(), 'db', 'migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'
  );
  // Single instance expected, but be safe against concurrent runs.
  await client.query('select pg_advisory_lock(727701)');
  const applied = new Set(
    (await client.query('select name from schema_migrations')).rows.map((r) => r.name)
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    console.log(`applying ${file}`);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('migrations up to date');
} finally {
  await client.end();
}
