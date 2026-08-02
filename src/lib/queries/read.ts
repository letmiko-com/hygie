// Read helper for heavy aggregate queries. Measured on real data (6.5M
// observations): JIT emission costs ~70ms on the year-long series and never
// pays off at this volume, and the 4MB default work_mem spills the big
// GROUP BYs to disk (817ms -> 557ms on the all-time cumulative query with
// 32MB). SET LOCAL keeps both settings scoped to this transaction.
import type { QueryResultRow } from 'pg';
import { withTransaction } from '@/lib/db';

export async function heavyRead<R extends QueryResultRow>(
  text: string,
  values: unknown[]
): Promise<R[]> {
  return withTransaction(async (client) => {
    await client.query("set local jit = off");
    await client.query("set local work_mem = '32MB'");
    const res = await client.query<R>(text, values);
    return res.rows;
  });
}
