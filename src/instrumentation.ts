// Next.js instrumentation hook: starts the in-process ingestion worker with the
// Node server. startIngestWorker() guards against double starts (one loop per
// process) and honors HYGIE_WORKER_DISABLED=1.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestWorker } = await import('@/lib/ingest/worker');
    startIngestWorker();
  }
}
