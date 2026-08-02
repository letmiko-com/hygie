// One-time bootstrap of the first admin (docs/architecture.md §5): at startup,
// if the users table is EMPTY and HYGIE_BOOTSTRAP_ADMIN_EMAIL is set, create
// the admin user + a subject with the same name + the owner grant. Never runs
// again once any user exists. Called from src/instrumentation.ts; must never
// break the ingest worker (callers catch).
import { withTransaction } from '@/lib/db';

const BOOTSTRAP_LOCK = 727702; // distinct from the migration runner's 727701

export async function bootstrapFirstAdmin(): Promise<void> {
  const email = process.env.HYGIE_BOOTSTRAP_ADMIN_EMAIL?.trim();
  if (!email) return;
  if (!email.includes('@')) {
    console.error('[bootstrap] HYGIE_BOOTSTRAP_ADMIN_EMAIL is not a valid email address, skipping');
    return;
  }

  const created = await withTransaction(async (client) => {
    // Serialize concurrent boots; re-check inside the lock.
    await client.query('select pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    const { rows } = await client.query<{ n: string }>('select count(*) as n from users');
    if (Number(rows[0].n) > 0) return false;

    const displayName = email.split('@')[0];
    const user = await client.query<{ id: string }>(
      `insert into users (email, display_name, is_admin) values ($1, $2, true) returning id`,
      [email, displayName]
    );
    const subject = await client.query<{ id: string }>(
      `insert into subjects (display_name) values ($1) returning id`,
      [displayName]
    );
    await client.query(
      `insert into access_grants (user_id, subject_id, role) values ($1, $2, 'owner')`,
      [user.rows[0].id, subject.rows[0].id]
    );
    return true;
  });

  if (created) {
    // No email address in logs: the operator knows which address they configured.
    console.log(
      '[bootstrap] first admin created from HYGIE_BOOTSTRAP_ADMIN_EMAIL (user + subject + owner grant); remove the variable after first login'
    );
  }
}
