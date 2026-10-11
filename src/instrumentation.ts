// Next.js instrumentation hook: starts the in-process ingestion worker with the
// Node server. startIngestWorker() guards against double starts (one loop per
// process) and honors HYGIE_WORKER_DISABLED=1.
// Also runs the one-time first-admin bootstrap (src/lib/auth/bootstrap.ts);
// a bootstrap failure is logged and never prevents the worker from starting.
// Error reporting (src/lib/sentry.ts, off unless SENTRY_DSN is set) comes up
// first, so that a failure of what follows is reported.
import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initErrorReporting, reportError } = await import('@/lib/sentry');
    initErrorReporting();
    const { startIngestWorker } = await import('@/lib/ingest/worker');
    startIngestWorker();
    const { bootstrapFirstAdmin } = await import('@/lib/auth/bootstrap');
    await bootstrapFirstAdmin().catch((err: unknown) => {
      console.error(`[bootstrap] failed: ${err instanceof Error ? err.message : String(err)}`);
      reportError(err, 'bootstrap');
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('@/lib/sentry');
  reportRequestError(err, request, context);
};
