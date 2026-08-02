// Next.js instrumentation hook: starts the in-process ingestion worker with the
// Node server. startIngestWorker() guards against double starts (one loop per
// process) and honors HYGIE_WORKER_DISABLED=1.
// Also runs the one-time first-admin bootstrap (src/lib/auth/bootstrap.ts);
// a bootstrap failure is logged and never prevents the worker from starting.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestWorker } = await import('@/lib/ingest/worker');
    startIngestWorker();
    const { bootstrapFirstAdmin } = await import('@/lib/auth/bootstrap');
    await bootstrapFirstAdmin().catch((err: unknown) => {
      console.error(`[bootstrap] failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
