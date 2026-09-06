// Migrations are never run automatically here (docs/architecture.md): a
// release can be live before the operator applied the migration it ships
// with. A read path on a table born in that migration must therefore
// tolerate its absence and read as "no data" instead of taking the whole
// page down (seen on 2026-09-06: /ecg and the dashboard answered 500 between
// the deploy of 0006 and its application). Only undefined_table is caught;
// every other error still surfaces.
const UNDEFINED_TABLE = '42P01';

export async function untilMigrated<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_TABLE) {
      return fallback;
    }
    throw err;
  }
}
