// Heart rate variability derived from the beat-to-beat intervals of a
// heartbeat series (HKHeartbeatSeriesSample, docs/native-format.md).
//
// The wire array holds the delay between consecutive beats in milliseconds,
// with `null` where HealthKit reported a gap: beats were missed there, so
// that delay is NOT an RR interval. Every metric below therefore works on
// runs of consecutive non-null entries, never across a gap — averaging over
// a gap would invent a slow beat that never happened.
//
// Apple publishes one number of its own, an SDNN over a 60 s window, as an
// ordinary quantity sample. Computing from the intervals gives the rest
// (RMSSD, pNN50) and, above all, the freedom to choose the window.

export interface HrvMetrics {
  /** Intervals that are real RR intervals (non-null, positive). */
  validCount: number;
  /** Gaps reported inside the series. */
  gapCount: number;
  meanRrMs: number | null;
  meanHrBpm: number | null;
  /** Standard deviation of the RR intervals (sample, n-1). */
  sdnnMs: number | null;
  /** Root mean square of successive differences, within runs only. */
  rmssdMs: number | null;
  /** Share of successive pairs differing by more than 50 ms, in percent. */
  pnn50Pct: number | null;
}

/** Below this, a metric describes noise rather than a heart. */
const MIN_INTERVALS = 2;
const MIN_PAIRS = 2;

export function hrvMetrics(intervals: ReadonlyArray<number | null>): HrvMetrics {
  const valid: number[] = [];
  // Successive differences, only between two intervals that are adjacent in
  // the series AND both real.
  const diffs: number[] = [];
  let gapCount = 0;
  let previous: number | null = null;

  for (const raw of intervals) {
    const v = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
    if (v === null) {
      gapCount++;
      previous = null;
      continue;
    }
    valid.push(v);
    if (previous !== null) diffs.push(v - previous);
    previous = v;
  }

  const out: HrvMetrics = {
    validCount: valid.length,
    gapCount,
    meanRrMs: null,
    meanHrBpm: null,
    sdnnMs: null,
    rmssdMs: null,
    pnn50Pct: null,
  };
  if (valid.length < MIN_INTERVALS) return out;

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  out.meanRrMs = mean;
  out.meanHrBpm = 60_000 / mean;
  const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1);
  out.sdnnMs = Math.sqrt(variance);

  if (diffs.length >= MIN_PAIRS) {
    out.rmssdMs = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / diffs.length);
    out.pnn50Pct = (diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100;
  }
  return out;
}
