// In-process memory cache. The Node process is persistent on Railway (no
// serverless), so a Map is enough. Keys must embed everything that changes the
// result (subject, local day, ...): entries are never invalidated explicitly,
// they expire or get superseded by a new key.
//
// It no longer holds a single health series. The all-time and long-window
// series it was propping up read rollup_hourly now (queries/series.ts) and are
// fetched live on every request, so a moved cutover or a fresh batch shows up
// immediately. What is left has nothing to do with the rollups and would not
// benefit from them:
//
//   metric-types  (10 min) taxonomy, changes only when the seed script runs;
//   catalog       (30 min) which types this subject has ever measured — ~100
//                          index probes, and a picker does not need to grow
//                          the second a new type lands;
//   totals        (6 h)    coverage bounds and row counts of the sync screen;
//   typecounts    (24 h)   observations per type for this subject, the one
//                          full index sweep of the app (~0.7-1s). NOT
//                          replaceable by sum(rollup_hourly.n): for a
//                          cumulative type n counts merged contributions
//                          (one per winning hour, one per minute), not source
//                          rows, and the sync screen counts source rows.
//
// All four are metadata or counts, none is a value a chart displays.

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 500;

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  // Deduplicate concurrent computations of the same key (a dashboard fires
  // several cards at once on a cold cache).
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await compute();
      if (store.size >= MAX_ENTRIES) evict(now);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

function evict(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Still full of live entries: drop the oldest insertions (Map keeps order).
  while (store.size >= MAX_ENTRIES) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}
