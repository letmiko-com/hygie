// Lazy pg pool. Never instantiated at module load: Next evaluates modules during
// build where DATABASE_URL may be absent. Callers use getDb() at request/worker time.
import pg from 'pg';

let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (pool === null) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.HYGIE_PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Without a handler, an idle client error crashes the process.
    pool.on('error', (err) => {
      console.error(`[db] idle client error: ${err.message}`);
    });
  }
  return pool;
}

/** Closes the pool (worker shutdown, test harness). Safe to call when never opened. */
export async function closeDb(): Promise<void> {
  if (pool !== null) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Runs fn inside a transaction on a dedicated client. Rolls back on throw. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // connection may be gone; release() below flags it
    }
    throw err;
  } finally {
    client.release();
  }
}
