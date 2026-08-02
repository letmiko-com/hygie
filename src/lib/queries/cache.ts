// In-process memory cache for reads that exceed the 500ms budget (all-time
// series, per-type counts). The Node process is persistent on Railway (no
// serverless), so a Map is enough. Keys must embed everything that changes
// the result (subject, type, local day, cutover): entries are never
// invalidated explicitly, they expire or get superseded by a new key.
// This cache disappears the day rollups are built.

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
