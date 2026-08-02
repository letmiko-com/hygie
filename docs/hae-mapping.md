# Health Auto Export → HealthKit mapping

Verified against real payloads on 2026-08-02 (JSON format v2, `automation-aggregation:
Default`). This file is the contract for the HAE adapter and the taxonomy seed. HAE units
are user-configurable: the adapter always reads the payload's `units` field and converts
to the canonical unit; the values below are what was observed, not an assumption.

Regimes: `raw` = raw samples, dedupable against the XML backfill; `minute` = per-minute
aggregates already deduplicated by Apple (never merged with raw records); `daily` =
daily summary shapes.

| HAE name | HK identifier | Observed unit | Regime | Notes |
|---|---|---|---|---|
| heart_rate | HKQuantityTypeIdentifierHeartRate | count/min | raw | `{date, Min, Avg, Max, source}`; raw samples keep Min==Avg==Max; keeps seconds (others truncate to :00) |
| resting_heart_rate | HKQuantityTypeIdentifierRestingHeartRate | count/min | raw | |
| walking_heart_rate_average | HKQuantityTypeIdentifierWalkingHeartRateAverage | count/min | raw | |
| heart_rate_variability | HKQuantityTypeIdentifierHeartRateVariabilitySDNN | ms | raw | |
| respiratory_rate | HKQuantityTypeIdentifierRespiratoryRate | count/min | raw | |
| blood_oxygen_saturation | HKQuantityTypeIdentifierOxygenSaturation | % | raw | XML stores fraction 0-1, JSON percent 0-100 |
| body_temperature | HKQuantityTypeIdentifierBodyTemperature | degC | raw | |
| apple_sleeping_wrist_temperature | HKQuantityTypeIdentifierAppleSleepingWristTemperature | degC | raw | |
| breathing_disturbances | HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances | count | raw | |
| headphone_audio_exposure | HKQuantityTypeIdentifierHeadphoneAudioExposure | dBASPL | raw | |
| physical_effort | HKQuantityTypeIdentifierPhysicalEffort | kcal/hr·kg | raw | |
| stair_speed_up | HKQuantityTypeIdentifierStairAscentSpeed | m/s | raw | |
| stair_speed_down | HKQuantityTypeIdentifierStairDescentSpeed | m/s | raw | |
| walking_speed | HKQuantityTypeIdentifierWalkingSpeed | km/hr | raw | |
| walking_step_length | HKQuantityTypeIdentifierWalkingStepLength | cm | raw | |
| walking_asymmetry_percentage | HKQuantityTypeIdentifierWalkingAsymmetryPercentage | % | raw | |
| walking_double_support_percentage | HKQuantityTypeIdentifierWalkingDoubleSupportPercentage | % | raw | |
| time_in_daylight | HKQuantityTypeIdentifierTimeInDaylight | min | raw | |
| dietary_water | HKQuantityTypeIdentifierDietaryWater | mL | raw | |
| alcohol_consumption | HKQuantityTypeIdentifierNumberOfAlcoholicBeverages | count | raw | |
| step_count | HKQuantityTypeIdentifierStepCount | count | minute | Apple-deduplicated (watch+iPhone), composite source `A\|B` |
| active_energy | HKQuantityTypeIdentifierActiveEnergyBurned | kJ | minute | XML is kcal (factor 4.184) |
| basal_energy_burned | HKQuantityTypeIdentifierBasalEnergyBurned | kJ | minute | idem |
| walking_running_distance | HKQuantityTypeIdentifierDistanceWalkingRunning | km | minute | |
| flights_climbed | HKQuantityTypeIdentifierFlightsClimbed | count | minute | |
| apple_exercise_time | HKQuantityTypeIdentifierAppleExerciseTime | min | minute | |
| apple_stand_time | HKQuantityTypeIdentifierAppleStandTime | min | minute | |
| apple_stand_hour | HKCategoryTypeIdentifierAppleStandHour | count | daily | category in XML |
| sleep_analysis | HKCategoryTypeIdentifierSleepAnalysis | hr | daily | daily summary (asleep/core/deep/rem/awake/inBed + sleepStart/sleepEnd); raw stages exist only in XML |
| sexual_activity | HKCategoryTypeIdentifierSexualActivity | count | daily | pivoted columns (Protection Used/Not Used/Unspecified); sensitive: opt-in |
| blood_pressure | HKQuantityTypeIdentifierBloodPressureSystolic + Diastolic | mmHg | raw | one JSON point = two HK records (`systolic`, `diastolic` fields) |

## Workouts (JSON v2)

- `id` is an HAE-side UUID, absent from the XML: store in `workout_external_ids`
  (namespace `hae`), match XML workouts via the fingerprint (activity type, start, end,
  source).
- `name` is a display name ("Outdoor Run"): map to `HKWorkoutActivityType*` (+
  `isIndoor`); mapping table to grow as activity types are observed.
- Trusted aggregates: distance, activeEnergyBurned/totalEnergy (kJ vs kcal!), elevation
  (cm in some fields), duration (seconds), step count sum.
- **Never ingest `avgHeartRate` / `maxHeartRate` as workout heart rate**: measured to be
  the 2-minute post-workout recovery window (`heartRateData`, 1 Hz).
- Minute series: activeEnergy, basalEnergy, stepCount, walkingAndRunningDistance →
  `workout_points`. `heartRateData` (post-workout recovery) → ignored for now.
- `route` is inline GPS: lat, lon, altitude, course, speed, accuracies, timestamp →
  `workout_route_points`.

## Cross-cutting parsing rules

- Dates: `YYYY-MM-DD HH:MM:SS ±HHMM` local with explicit offset (same convention as the
  XML). Seconds are truncated to `:00` for everything except heart_rate.
- Sources: normalize U+00A0 to a regular space; composite sources (`A|B`) are kept
  verbatim as synthetic sources (cannot be split reliably).
- Re-emissions are byte-stable: exact dedup by (type, source, ts, value_key) within the
  HAE origin is safe.
