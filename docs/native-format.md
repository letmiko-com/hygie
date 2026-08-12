# hygie-native/1 : the native ingestion format

The wire contract between the Hygie Sync iOS app (repo `hygie-ios`) and
`POST /api/v1/ingest/native`. Replaces the Health Auto Export channel
(`docs/hae-mapping.md`, kept as the reference for historical batches) and
fixes its measured defects by construction: full-precision timestamps,
HealthKit UUIDs on every sample (exact dedup), every quantity and category
type, raw sleep stages instead of a daily summary.

## Transport

- Same receive path as HAE (architecture §3): device key in
  `X-Hygie-Device-Key` checked before the body is read, body streamed to
  disk, batch row inserted, `200 {batch_id}` only after both are durable.
- Body: JSON, gzip on the wire (the server also accepts plain JSON).
- Batch rows carry `format_version = 'hygie-native-v1'`; the worker
  dispatches normalization on that value.

## Envelope

```json
{
  "format": "hygie-native/1",
  "app_version": "1.0.0",
  "device": { "name": "iPhone", "model": "iPhone17,1", "system": "iOS 26.0" },
  "exported_at": "2026-08-12T08:30:12+02:00",
  "samples": [ ... ],
  "minutes": [ ... ],
  "workouts": [ ... ]
}
```

All timestamps are ISO 8601 **with the local UTC offset** (`2026-08-12T08:12:03+02:00`).
The server stores UTC + `tz_offset_min` parsed from that offset, like every
other channel. Seconds and sub-seconds are kept as HealthKit provides them.

## samples — discrete quantities and categories

One entry per HKSample, straight from `HKAnchoredObjectQuery`:

```json
{ "uuid": "91F73E2A-…", "type": "HKQuantityTypeIdentifierHeartRate",
  "start": "2026-08-12T08:12:03+02:00", "end": "2026-08-12T08:12:03+02:00",
  "value": 72.0, "unit": "count/min", "source": "Apple Watch Ultra" }

{ "uuid": "0B7A…", "type": "HKCategoryTypeIdentifierSleepAnalysis",
  "start": "…", "end": "…", "category": 3, "source": "Apple Watch Ultra" }
```

- `value` + `unit` for quantity kinds; `category` (the raw HealthKit enum
  integer) for category kinds. Exactly one of the two must be present.
- **The app converts every quantity to the canonical unit of the taxonomy**
  before sending (kJ for energies, fractions for percentages, m, °C, …).
  The `unit` field is a control: a mismatch is counted per type
  (`unit_mismatch`) and the sample refused — the server never guesses a
  conversion. The app's unit table is generated from `db/taxonomy.json` by
  `scripts/gen-ios-taxonomy.mjs`; regenerate it whenever the taxonomy grows.
- `HKCategoryTypeIdentifierSleepAnalysis` samples land in `sleep_segments`
  (raw stages — richer than HAE's daily summary, same table as the XML
  backfill), never in `observations`. Category integers are validated
  against `metric_category_values.raw_value`, which stores the HealthKit
  enum values verbatim.

### Dedup rules (in order)

1. **By HealthKit UUID**: `observations.hk_uuid` / `sleep_segments.hk_uuid`
   are unique per subject (migration 0004). A replayed batch, an anchor
   reset, or two devices exporting the same store cannot duplicate a sample.
2. **Exact residual**: a sample matching an existing row of the same
   (type, source, start_ts, value_key) that carries **no** uuid (XML
   backfill rows, historical HAE rows) is dropped and counted
   (`deduped_exact`).
3. There is deliberately **no ±1s/minute-window multiset matching** in this
   channel: the app syncs from its pairing instant onward, so it never
   re-covers ground already held by uuid-less history. The gap between the
   last HAE batch and the pairing is backfilled by the next XML import,
   whose own guard (import-xml ≥ 0.2.0) handles that overlap.

Deleted objects reported by anchored queries are counted
(`deleted_reported`) and NOT applied: Hygie never deletes health data on a
device's say-so; reconciliation happens at the next XML backfill.

## minutes — cumulative types

The two-regime rule (architecture §2) is unchanged. For the 7
`minute_cumulative` types (steps, active/basal energy, walking distance,
flights, exercise/stand time) the app pushes **HealthKit's own
deduplicated per-minute statistics** (`HKStatisticsCollectionQuery`,
cumulative sum, no source separation — the same numbers the Santé app
displays):

```json
{ "type": "HKQuantityTypeIdentifierStepCount",
  "minute": "2026-08-12T08:12:00+02:00", "value": 34.0, "unit": "count" }
```

Normalization reuses the HAE minute path verbatim (cutover bootstrap,
device authority, conflict logging, rollup invalidation): the channel
changes, the truth rules do not. Raw discrete samples of those types are
NOT sent (they would double the pre-cutover raw channel).

## workouts

```json
{ "uuid": "5D2E…", "activity": "HKWorkoutActivityTypeCycling",
  "start": "…", "end": "…", "duration_s": 3745.2, "distance_m": 26637.0,
  "energy_kj": 2778.6, "elevation_up_m": 233.0, "indoor": false,
  "source": "Apple Watch Ultra" }
```

Identity, in order: `workout_external_ids` under namespace `healthkit`
(the HealthKit UUID); else the existing fingerprint match (same subject,
activity, start ±1s) adopts the row and records the identity; else insert.
Same counters as HAE (`matched_external`, `matched_fingerprint`,
`inserted`, `external_id_other_subject`).

No dedicated workout points: the high-frequency in-workout heart rate
arrives through `samples` like any other reading, and the workout detail
screen falls back to `observations` when a workout has no
`workout_points` rows.

## Explicitly out of scope in v1 (v2 candidates)

ECGs (`HKElectrocardiogram`, needs its own table and screen), workout GPS
routes (`HKWorkoutRoute`), activity summaries (rings), audiograms,
clinical records.
