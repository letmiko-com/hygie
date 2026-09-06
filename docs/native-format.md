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
  before sending (kJ for energies, m, °C, …). One exception, percentages: the
  canonical `%` is 0-100 (Apple's XML export and HAE both carry 97 for 97 %,
  and so do 99 % of the rows in the database), but `HKUnit.percent()` hands
  the app a fraction (0.97) and hygie-native/1 sends it as is. The server
  scales `%` values by 100 at ingestion (normalize-native.ts) until
  hygie-native/2 has the app send 0-100; that change and the removal of the
  server-side scaling must ship together.
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

Deleted objects reported by anchored queries are ignored by the app (the
wire format carries no deletion field) and therefore never applied: Hygie
never deletes health data on a device's say-so; reconciliation happens at
the next XML backfill.

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

## Series sections (additive, since Hygie Sync 1.1)

Six optional top-level arrays extend the format without a version bump: an
older app never sends them, a server that predates them ignores unknown keys
(the shape check only requires that a present key be an array). Timestamps
follow the same ISO 8601 + offset rule as everything else. Each section has
its own counters block in `ingest_batches.counts` (`routes`,
`activity_summaries`, `ecgs`, `audiograms`, `heartbeat_series`,
`state_of_mind`). The first four shipped with 1.1, the last two with 1.2.

### routes — GPS track of a workout (`HKWorkoutRoute`)

```json
{ "workout_uuid": "5D2E…", "uuid": "9A1C…", "source": "Apple Watch Ultra",
  "points": [ { "t": "2026-09-06T08:12:03.000+02:00", "lat": 43.712, "lon": 3.914,
                "alt": 52.1, "speed": 3.2, "course": 181.0, "hacc": 4.5 } ] }
```

`workout_uuid` is the HealthKit uuid of the workout, which must already be
known under namespace `healthkit` for the device's subject (send the
`workouts` entry in the same or an earlier batch; an unknown workout is
counted `workout_unknown` and the route dropped, the app re-sends it later).
`alt` in metres, `speed` in m/s, `course` in degrees, `hacc` horizontal
accuracy in metres; all optional. Points land in `workout_route_points`, the
same table the HAE inline route used; identity is (workout, timestamp), so a
re-sent route never duplicates a point. Bound: 250 000 points per route.

The app sends a route once its workout has been acknowledged, and keeps a
workout in a pending list until a route was found or seven days passed: the
watch often hands the route over minutes to hours after the workout itself.

### activity_summaries — the rings (`HKActivitySummary`)

```json
{ "day": "2026-09-06", "move_mode": "energy",
  "move_kj": 1854.3, "move_goal_kj": 2510.4,
  "move_time_min": null, "move_time_goal_min": null,
  "exercise_min": 34, "exercise_goal_min": 30,
  "stand_h": 9, "stand_goal_h": 12, "paused": false }
```

One entry per calendar day of the device; `move_mode` is `energy` (kJ, like
workouts) or `time` (minutes) depending on the watch setting. The app
re-emits the last 7 days on every sync (goals change, the current day
evolves); the server upserts into `activity_summaries` and only registers
real changes (`inserted` / `updated` / `unchanged`).

### ecgs — electrocardiograms (`HKElectrocardiogram`)

```json
{ "uuid": "7B3F…", "start": "…", "end": "…", "source": "Apple Watch Ultra",
  "classification": "sinus_rhythm", "symptoms": "none", "avg_hr_bpm": 62,
  "sampling_hz": 512.0, "algorithm_version": 2,
  "lead": "apple_watch_similar_to_lead_i",
  "voltages_uv": [ 12, 15, 19, … ] }
```

`classification` is the HealthKit enum as a snake_case token (`not_set`,
`sinus_rhythm`, `atrial_fibrillation`, `inconclusive_low_heart_rate`,
`inconclusive_high_heart_rate`, `inconclusive_poor_reading`,
`inconclusive_other`, `unrecognized`; any other lowercase token is stored as
is so a future value is never lost); `symptoms` is `not_set`, `none` or
`present`. Voltages are integer microvolts at `sampling_hz`, at most 60 000
per recording; the server clamps to int16. Identity: uuid per subject, then
the start second per subject against uuid-less rows imported from the CSV
files of an export (the source name differs between channels: the CSV names
the hardware model, HealthKit the user's watch). Table `ecg_recordings`.

### audiograms — hearing tests (`HKAudiogramSample`)

```json
{ "uuid": "C0DE…", "start": "…", "end": "…", "source": "Health",
  "points": [ { "hz": 1000, "side": "left", "db_hl": 20, "masked": false,
                "conduction": "air", "clamped": null } ] }
```

One point per (side, frequency, masked); `db_hl` in dB HL, `clamped` is
`low` or `high` when the value sits on a bound of the device's measurable
range. Same identity discipline as ECGs. Tables `audiograms` and
`audiogram_points`. At most 64 points per audiogram.

### heartbeat_series — beat-to-beat intervals (`HKHeartbeatSeriesSample`)

```json
{ "uuid": "3E7A…", "start": "2026-09-06T08:12:03.000+02:00",
  "end": "2026-09-06T08:13:03.000+02:00", "source": "Apple Watch Ultra",
  "intervals_ms": [ 812, 843, null, 798, … ] }
```

One entry per series. `intervals_ms[i]` is the delay in milliseconds between
beat *i* and beat *i+1*, so a series of *n* beats carries *n-1* entries.
**`null` means HealthKit reported a gap before that beat** (`precededByGap`):
one or more beats were missed, the delay is not an RR interval, and every
derived metric skips it. The app also sends `null` rather than a value above
32 s, the smallint ceiling of the column.

The server derives, once, over the valid intervals only: mean RR, mean heart
rate, SDNN, RMSSD and pNN50 (`heartbeat_series`). Aggregating a period reads
those columns, never the arrays; the arrays serve the tachogram of one
series. Metrics are left null below 2 valid intervals for SDNN/mean and below
2 successive valid pairs for RMSSD/pNN50 — a metric on one beat is not a
metric. Identity: uuid per subject, then the start second, like ECGs. Bound:
100 000 intervals per series.

This is the only channel that carries the raw intervals. The Apple Health
XML export does not contain them (it publishes Apple's 60 s SDNN as an
ordinary quantity sample and nothing else), so **there is no backfill path**:
what the app does not read on the phone is lost. Hence the rewind below.

### state_of_mind — self-reported feelings (`HKStateOfMind`, iOS 18)

```json
{ "uuid": "A11C…", "start": "2026-09-06T21:30:00+02:00", "source": "Health",
  "kind": "daily_mood", "valence": 0.42, "valence_classification": 5,
  "labels": ["content", "grateful"], "associations": ["family", "hobbies"] }
```

`kind` is `momentary_emotion` or `daily_mood`. `valence` is the signed scale
HealthKit hands over, -1 (very unpleasant) to +1 (very pleasant);
`valence_classification` is Apple's own 7-region bucketing of that value,
sent as the raw enum integer rather than recomputed server-side because the
thresholds are not public. `labels` and `associations` are the HealthKit
enums as snake_case tokens (`happy`, `overwhelmed`, `work`, `family`, …),
accepted unbounded so a value added by a future iOS is stored rather than
dropped. Identity: uuid per subject, then (kind, start second) — the two
kinds can legitimately share a timestamp. Table `state_of_mind`. Bounds: 64
labels and 64 associations per entry.

Like heartbeat series, state of mind is **absent from the XML export**.

### The pairing rewind (Hygie Sync 1.2)

Every other section starts at the pairing instant, because history reaches
the server through the XML backfill. These two have no such path: HealthKit
on the phone is the only place they exist. So the app performs a **one-off
rewind** for these two types only — anchored queries with no start
predicate, walked in chunks until HealthKit reports the store exhausted,
then the ordinary anchored regime takes over. The rewind is recorded as done
in `AnchorStore` so it never runs twice, and it is bounded by chunk, so an
interrupted rewind resumes where its anchor stopped.

## Explicitly out of scope (still)

Scored assessments (GAD-7, PHQ-9), vision prescriptions, medications,
clinical records (entitlement gated). The first four were weighed on
2026-09-06 and left out for want of data to put in them, not for want of a
mapping: see the Hygie board card.
