/**
 * Bucket-mean downsampling for charts and sparklines: `target` buckets at
 * most, each the mean of the values it covers, null when it covers no value
 * at all (a gap stays a gap). Same bucketing as drill.bucketSpans, so a
 * downsampled point and its drill span always describe the same days.
 */
export function downsample(values: Array<number | null>, target: number): Array<number | null> {
  if (values.length <= target) return values;
  const size = Math.ceil(values.length / target);
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i += size) {
    const bucket = values.slice(i, i + size).filter((v): v is number => v !== null);
    out.push(bucket.length === 0 ? null : bucket.reduce((a, b) => a + b, 0) / bucket.length);
  }
  return out;
}
