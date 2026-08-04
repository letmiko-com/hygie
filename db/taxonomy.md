# Taxonomy: what `db/taxonomy.json` decides, and why

`taxonomy.json` is the seed of `units`, `metric_types` and `metric_category_values`
(`scripts/seed-taxonomy.mjs`, idempotent, never deletes). It answers four questions per
HealthKit type: is it ingested, in what unit, at what precision, and how a set of samples
reduces to one number.

## Coverage

**97 types, all `supported = true`** (2026-08-04). The list is not aspirational: every entry
was inventoried from Julien's real `export.xml` — type name, `unit` attribute, and for
category kinds the exact `value` strings. Nothing in the file is absent from the export, and
nothing in the export is absent from the file.

Before that date 58 of them were `supported = false`: the importer counted them per type in
`import_runs.counts.skipped.unsupported_type` and inserted nothing, so body mass, nutrition,
audio-exposure events, mindful sessions, VO2 max and the rest simply did not exist in the
database. The allowlist was data minimization applied to a single-user instance that owns
all of its own data; the per-subject opt-in (`subject_metric_settings`) remains the right
mechanism for future members and is untouched.

`HKCategoryTypeIdentifierSexualActivity` was already `supported` but had no row in
`metric_category_values`, so the importer dropped its records as
`category_without_contract`. Every category type now carries its contract; the seed asserts
it.

## Aggregation: how samples become one number per bucket

`metric_types.aggregation` is the reducer the read layer applies to a day, an hour or a
minute (`valueExpr()` in `src/lib/queries/series.ts`). It has product consequences beyond
arithmetic: a quantity type with `aggregation = 'none'` is **invisible** in the explorer's
catalogue, so "ingested" and "chartable" are the same decision.

| Value | Meaning | When it is the right answer |
|---|---|---|
| `sum` | total over the bucket | flows that accumulate: steps, distance, energy, nutrients |
| `average` | mean of the samples | rates and levels sampled repeatedly: heart rate, speed, dB, temperature |
| `latest` | last sample of the bucket | states that persist between measurements: body mass, height, a goal |
| `duration` | seconds covered by `[start_ts, end_ts)` | category events that occupy time: sleep stages, mindful sessions |
| `none` | not reducible | point events with no magnitude |

Only `sum` and `average` can be reduced back out of `rollup_hourly`
(`ROLLUP_AGGREGATIONS`), so `latest` and `duration` types always read from the sources
whatever the window width. That is affordable here because they are sparse by nature (body
mass: thousands of rows over fourteen years, not millions).

### The choices that are not obvious

- **Body measurements** (`BodyMass`, `BodyFatPercentage`, `BodyMassIndex`, `LeanBodyMass`,
  `Height`) are `latest`, never `sum`: weighing yourself twice on Sunday does not make you
  twice as heavy. `latest` over `average` because a body measurement is a state with a
  timestamp, and the day's answer to "what do I weigh" is the last scale reading, not the
  mean of a morning and an evening one.
- **`HKDataTypeSleepDurationGoal`** is `latest` for the same reason: it is a setting, not a
  measurement.
- **Nutrients** (all 35 `Dietary*` types, water included) are `sum`. Food is logged per meal
  and the useful figure is the daily intake.
- **`DietaryEnergyConsumed` is stored in kJ**, not kcal: energy has one canonical unit in
  this database (`ActiveEnergyBurned` and `BasalEnergyBurned` are already kJ, converted from
  the XML's kcal by 4.184), which is what makes intake and expenditure comparable without
  the read layer knowing which type it holds. The XML stays kcal; the factor does the work.
  Display converts back (`src/lib/format.ts`).
- **`SixMinuteWalkTestDistance` is `average`, not `sum`**, although it is a distance in
  metres. It is a test result, not travelled ground: two tests in one day average, they do
  not add up. `DistanceRowing` by contrast is `sum` like `DistanceCycling` — real ground
  covered, sampled in slices.
- **Audio exposure** (`EnvironmentalAudioExposure`, `EnvironmentalSoundReduction`) is
  `average`: decibels are logarithmic, adding them means nothing.
- **`UnderwaterDepth` and `WaterTemperature` are `average`** because they are continuously
  sampled during a dive. The figure a diver actually wants is the maximum depth: it is
  already stored per hour in `rollup_hourly.max`, and no `max` aggregation was invented for
  one type.
- **Effort scores** (`WorkoutEffortScore`, `EstimatedWorkoutEffortScore`) are `average`: a
  1-10 score per workout, meaningless to add, and a day can hold two workouts.
- **Slowly-varying estimates** (`VO2Max`, `AppleWalkingSteadiness`,
  `AtrialFibrillationBurden`, `HeartRateRecoveryOneMinute`) are `average` rather than
  `latest`: Apple emits them irregularly and the mean of a day is more robust than whichever
  sample landed last, and unlike body measurements they are already estimates over a window.
- **`MindfulSession` is `duration`**: the records carry a start and an end, and the question
  is how many minutes were spent, not how many sessions were opened.
- **The four `*Event` categories** (`HighHeartRateEvent`, `LowHeartRateEvent`,
  `AudioExposureEvent`, `HeadphoneAudioExposureEvent`) are `none`. Their HealthKit value is
  `HKCategoryValueNotApplicable` or a limit-crossing flag: there is no magnitude to reduce,
  only occurrences to count and to place on a timeline.

## Category-value contracts

`metric_category_values.raw_value` is HealthKit's own numeric code, not an internal
sequence: `HKCategoryValueNotApplicable = 0`, sleep stages 0-5, stand hour 0-1, and the two
audio-exposure event enums start at 1 (`momentaryLimit`, `sevenDayLimit`). `hk_value` keeps
Apple's constant as the raw reference and `slug` is the stable name the product uses. A
category record whose XML `value` is not in the contract is **counted and dropped**, never
guessed: growing the table is the way to ingest a new value.

## `hae_regime` is about Health Auto Export, not about support

`hae_regime` says which HAE channel feeds a type (`raw_discrete`, `minute_cumulative`,
`daily_summary`) and stays `unsupported` for every type HAE has not been *measured* to send.
`docs/hae-mapping.md` is that contract, 31 entries verified against real payloads; the
adapter refuses to normalize a type whose regime is `unsupported`, which is the desired
behaviour — a guessed HAE unit is a silently wrong value.

So `supported = true` with `hae_regime = 'unsupported'` is a normal, deliberate combination:
**the type is ingested from the XML backfill only.** 65 of the 97 types are in that state
today. Promoting one to a real regime requires a measured payload, not an assumption.

## Quantize scale

`value_key = round(value * quantize_scale)` is the identity used for exact dedup within an
origin. `1000` everywhere except distances in km (`1000000`, so a metre is distinguishable).
It is a precision floor, not a display concern.
