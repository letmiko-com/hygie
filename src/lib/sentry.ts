// Optional error reporting to Sentry, or to any service that speaks its
// protocol (GlitchTip, Bugsink). Off unless SENTRY_DSN is set: a self-hosted
// health app does not phone home by default, and without the variable every
// function below returns at its first line.
//
// Built on @sentry/core alone (one transitive dependency), not @sentry/node:
// the Node SDK pulls OpenTelemetry and patches http, pg and the console to
// collect requests, queries and breadcrumbs on its own. Here nothing is
// collected implicitly. Every report is an explicit call, and what it may
// carry is decided in this file:
// - sent: the error's type and message, its stack frames (file, function,
//   line; no source lines, no variables), a code when the error has one
//   (SQLSTATE, errno, batch validation code), where it happened (a fixed
//   label, or the route TEMPLATE for requests, never the URL), release and
//   environment;
// - never sent: request bodies, headers, cookies, query strings (the magic
//   link carries a token and an address there), users, breadcrumbs, the
//   extra fields of an error (a Postgres error's detail quotes the row) or
//   its cause.
// The message follows the server log of the same failure: callers that log
// only err.name (mail errors can quote an address) withhold it here too, and
// Postgres data exceptions (SQLSTATE class 22, whose messages can quote the
// offending value) travel as their code alone.
//
// SENTRY_INGEST_MONITOR (a monitor slug) also turns on a cron check-in each
// time a batch completes the pipeline: see reportIngestHeartbeat().
import {
  ServerRuntimeClient,
  captureCheckIn,
  captureException,
  createStackParser,
  createTransport,
  initAndBind,
  makeDsn,
  nodeStackLineParser,
  withScope,
  type BaseTransportOptions,
  type ErrorEvent,
  type EventHint,
  type MonitorConfig,
  type Transport,
  type TransportRequest,
} from '@sentry/core';
import { staleAfterMs } from '@/lib/silence';

// The same failure is reported at most once per window and per process: a
// database outage fails the worker loop every 5 seconds, and the free plan
// counts 5,000 errors a month.
const REPORT_EVERY_MS = 10 * 60 * 1000;
const MAX_TRACKED_FAILURES = 500;
const SEND_TIMEOUT_MS = 10_000;
// Sentry accepts 6 check-ins a minute per monitor, and a backlog drains
// hundreds of batches in a row: one check-in per window is plenty for a
// silence measured in hours.
const CHECK_IN_EVERY_MS = 10 * 60 * 1000;
const CHECK_IN_MARGIN_MIN = 60;
const MONITOR_SLUG_RE = /^[a-z0-9_-]{1,50}$/;

interface SentryState {
  enabled: boolean;
  lastReported: Map<string, number>;
  monitorSlug: string | null;
  lastCheckIn: number;
}

// Next builds instrumentation, route handlers and the proxy as separate module
// graphs in one process: the state lives on globalThis, like the worker's.
const STATE_KEY = Symbol.for('hygie.sentry');

function state(): SentryState {
  const g = globalThis as { [STATE_KEY]?: SentryState };
  return (g[STATE_KEY] ??= { enabled: false, lastReported: new Map(), monitorSlug: null, lastCheckIn: 0 });
}

function fetchTransport(options: BaseTransportOptions): Transport {
  return createTransport(options, async (request: TransportRequest) => {
    const res = await fetch(options.url, {
      method: 'POST',
      body: request.body as BodyInit,
      headers: options.headers,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    return {
      statusCode: res.status,
      headers: {
        'x-sentry-rate-limits': res.headers.get('x-sentry-rate-limits'),
        'retry-after': res.headers.get('retry-after'),
      },
    };
  });
}

/** A short string `code` (SQLSTATE, errno, BatchValidationError), if any. */
function errorCode(err: unknown): string | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code.length > 0 && code.length <= 40 ? code : null;
}

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

// The SDK's own DSN pattern (@sentry/core utils/dsn.ts), checked first: on a
// malformed value the SDK prints the whole DSN, key included, to the log.
const DSN_RE = /^(?:(\w+):)\/\/(?:(\w+)(?::(\w+)?)?@)((?:\[[:.%\w]+\]|[\w.-]+))(?::(\d+))?\/(.+)/;

function scrub(event: ErrorEvent, hint: EventHint): ErrorEvent {
  // Nothing in this file sets them; dropped anyway so that no future default
  // of the SDK can add them silently.
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  const code = errorCode(hint.originalException);
  const withheld = (hint.data as { withholdMessage?: boolean } | undefined)?.withholdMessage === true;
  const dataException = code !== null && SQLSTATE_RE.test(code) && code.startsWith('22');
  if (withheld || dataException) {
    for (const ex of event.exception?.values ?? []) {
      ex.value = dataException ? `PostgreSQL data exception ${code} (message withheld)` : 'message withheld';
    }
  }
  return event;
}

/**
 * Turns reporting on when SENTRY_DSN is set. Called once at startup by the
 * instrumentation hook, before the worker starts.
 */
export function initErrorReporting(): void {
  const s = state();
  if (s.enabled) return;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  if (!DSN_RE.test(dsn) || !makeDsn(dsn)) {
    console.error('[sentry] SENTRY_DSN is not a valid DSN, error reporting stays off');
    return;
  }
  const environment = process.env.SENTRY_ENVIRONMENT?.trim() || 'production';
  initAndBind(ServerRuntimeClient, {
    dsn,
    transport: fetchTransport,
    stackParser: createStackParser(nodeStackLineParser()),
    // No default integration: no request data, no linked causes, no extra
    // error fields. What leaves is built by reportError() alone.
    integrations: [],
    environment,
    // On Railway the deployed commit stands in: a ${{RAILWAY_GIT_COMMIT_SHA}}
    // reference in SENTRY_RELEASE resolves to an empty string there.
    release:
      process.env.SENTRY_RELEASE?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || undefined,
    platform: 'node',
    runtime: { name: 'node', version: process.version },
    maxBreadcrumbs: 0,
    sendClientReports: false,
    enhanceFetchErrorMessages: false,
    beforeSend: scrub,
  });
  const slug = process.env.SENTRY_INGEST_MONITOR?.trim();
  if (slug && MONITOR_SLUG_RE.test(slug)) {
    s.monitorSlug = slug;
  } else if (slug) {
    console.error(
      '[sentry] SENTRY_INGEST_MONITOR must be a slug (a-z, 0-9, - and _, 50 at most), ingest monitor stays off'
    );
  }
  s.enabled = true;
  console.log(
    `[sentry] error reporting on (environment ${environment}, ingest monitor ${s.monitorSlug ?? 'off'})`
  );
}

export interface ReportOptions {
  /** Small, value-free facts to attach (ids, step, attempt). */
  context?: Record<string, string | number | boolean | null>;
  /** The server log carries err.name only for this failure: so does the report. */
  withholdMessage?: boolean;
  /** Overrides the issue title's location (requests: "GET /route/[param]"). */
  transaction?: string;
  /** False for errors nothing caught (requests that failed with a 500). */
  handled?: boolean;
}

/**
 * Reports a caught failure. No-op when reporting is off; never throws.
 * `where` is a fixed label (`ingest.worker.batch`, `mail.magic-link`), used
 * as a tag and to rate-limit repeats.
 */
export function reportError(err: unknown, where: string, opts: ReportOptions = {}): void {
  const s = state();
  if (!s.enabled) return;
  try {
    // A thrown non-Error would be serialized key by key: replaced by its type.
    const error = err instanceof Error ? err : new Error(`non-Error value thrown (${typeof err})`);
    const key = `${where}|${opts.transaction ?? ''}|${error.name}|${error.message.slice(0, 200)}`;
    const now = Date.now();
    const last = s.lastReported.get(key);
    if (last !== undefined && now - last < REPORT_EVERY_MS) return;
    if (s.lastReported.size >= MAX_TRACKED_FAILURES) s.lastReported.clear();
    s.lastReported.set(key, now);

    withScope((scope) => {
      scope.setTag('where', where);
      const code = errorCode(error);
      if (code !== null) scope.setTag('error.code', code);
      if (opts.context) scope.setContext('hygie', opts.context);
      if (opts.transaction) scope.setTransactionName(opts.transaction);
      captureException(error, {
        originalException: error,
        data: { withholdMessage: opts.withholdMessage === true },
        mechanism: { type: 'hygie', handled: opts.handled ?? true },
      });
    });
  } catch {
    // Reporting must never break the code path that called it.
  }
}

/**
 * onRequestError of the instrumentation hook: errors Next caught in a page,
 * a route handler, a server action or the proxy. The route TEMPLATE stands
 * for the request (/metrics/[type], not the metric viewed); path, query and
 * headers stay here.
 */
export function reportRequestError(
  err: unknown,
  request: { method: string },
  context: { routePath: string; routeType: string }
): void {
  if (!state().enabled) return;
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : null;
  reportError(err, `request.${context.routeType}`, {
    transaction: `${request.method} ${context.routePath}`,
    context: { method: request.method, route: context.routePath, digest },
    handled: false,
  });
}

/**
 * The monitor's schedule, sent with every check-in so that the monitor is
 * created, then kept in line with the configuration, by the server itself.
 * The interval is the silence threshold (src/lib/silence.ts, 24 h by default).
 */
function ingestMonitorConfig(): MonitorConfig {
  const minutes = Math.max(1, Math.round(staleAfterMs() / 60_000));
  return {
    schedule:
      minutes % 60 === 0
        ? { type: 'interval', value: minutes / 60, unit: 'hour' }
        : { type: 'interval', value: minutes, unit: 'minute' },
    checkinMargin: Math.min(CHECK_IN_MARGIN_MIN, minutes),
    timezone: 'UTC',
    failureIssueThreshold: 1,
    recoveryThreshold: 1,
  };
}

/**
 * Dead man's switch on ingestion, end to end. Called when a batch reaches
 * rollups_ready; sends an `ok` check-in at most every 10 minutes.
 *
 * For an interval schedule, Sentry expects the next check-in one interval
 * after the last successful one (monitors/schedule.py and logic/mark_ok.py in
 * getsentry/sentry, read on 2026-10-11): the monitor fires after that long
 * without any batch completing, whatever stopped, the phones, the API behind
 * its proxy, the worker or the database. The in-app silence alert covers one
 * device going quiet, but it runs in this very worker and sends through SMTP;
 * this one watches from outside.
 */
export function reportIngestHeartbeat(): void {
  const s = state();
  if (!s.enabled || s.monitorSlug === null) return;
  const now = Date.now();
  if (now - s.lastCheckIn < CHECK_IN_EVERY_MS) return;
  s.lastCheckIn = now;
  try {
    captureCheckIn({ monitorSlug: s.monitorSlug, status: 'ok' }, ingestMonitorConfig());
  } catch {
    // Same rule as reportError: never break the caller.
  }
}
