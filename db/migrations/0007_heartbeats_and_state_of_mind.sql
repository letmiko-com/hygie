-- Two more additive sections of hygie-native/1 (docs/native-format.md),
-- carried by Hygie Sync 1.2: beat-to-beat heartbeat series and state of mind.
-- Expand step only, like 0006: nothing reads these tables until the screens
-- ship, and every read path goes through untilMigrated().
--
-- Neither type exists in an Apple Health XML export. HealthKit on the phone
-- is their ONLY source, which is why the app rewinds past its pairing
-- instant once for both (see docs/native-format.md).

-- Heartbeat series (HKHeartbeatSeriesSample): one row per series, the RR
-- intervals stored inline in milliseconds the way ECG voltages are. A watch
-- series is a minute of beats, so a row is small and always read whole.
--
-- intervals_ms[i] is the delay between beat i and beat i+1. A NULL element
-- means HealthKit reported a gap before that beat: one or more beats were
-- missed, so the delay is NOT an RR interval and every derived metric
-- ignores it. Milliseconds fit smallint by construction (32 s ceiling); the
-- app sends a longer delay as a gap.
create table heartbeat_series (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references subjects(id) on delete cascade,
  hk_uuid         uuid,
  source_id       smallint not null references sources(id),
  start_ts        timestamptz not null,
  end_ts          timestamptz,
  tz_offset_min   smallint not null,
  beat_count      integer not null check (beat_count >= 0),
  gap_count       integer not null default 0 check (gap_count >= 0),
  duration_s      double precision check (duration_s >= 0),
  intervals_ms    smallint[] not null,
  -- Derived once at ingestion over the valid intervals only: aggregating a
  -- period must never re-read the arrays. Null when too few valid intervals
  -- (a metric on one beat is not a metric).
  mean_rr_ms      double precision check (mean_rr_ms > 0),
  mean_hr_bpm     double precision check (mean_hr_bpm > 0),
  sdnn_ms         double precision check (sdnn_ms >= 0),
  rmssd_ms        double precision check (rmssd_ms >= 0),
  pnn50_pct       double precision check (pnn50_pct >= 0 and pnn50_pct <= 100),
  ingest_batch_id uuid references ingest_batches(id)
);
create unique index heartbeat_series_subject_hk_uuid_key
  on heartbeat_series (subject_id, hk_uuid) where hk_uuid is not null;
-- Same exact residual as ECGs (0006): date_trunc on a timestamptz is stable,
-- not immutable, so the index is built on the UTC-shifted timestamp.
create unique index heartbeat_series_subject_second_key
  on heartbeat_series (subject_id, source_id, (date_trunc('second', start_ts at time zone 'UTC')));
create index heartbeat_series_subject_start on heartbeat_series (subject_id, start_ts desc);

-- State of mind (HKStateOfMind, iOS 18): a self-reported feeling. valence is
-- the signed scale HealthKit hands over (-1 very unpleasant to +1 very
-- pleasant); valence_classification is Apple's own 7-region bucketing of it,
-- stored rather than recomputed because the thresholds are not public.
-- labels and associations are the HealthKit enums as snake_case tokens
-- (happy, overwhelmed, work, family, …), unbounded on purpose so a new iOS
-- value is never lost.
create table state_of_mind (
  id                     uuid primary key default gen_random_uuid(),
  subject_id             uuid not null references subjects(id) on delete cascade,
  hk_uuid                uuid,
  source_id              smallint not null references sources(id),
  start_ts               timestamptz not null,
  end_ts                 timestamptz,
  tz_offset_min          smallint not null,
  kind                   text not null check (kind in ('momentary_emotion', 'daily_mood')),
  valence                double precision not null check (valence >= -1 and valence <= 1),
  valence_classification smallint check (valence_classification between 1 and 7),
  labels                 text[] not null default '{}',
  associations           text[] not null default '{}',
  ingest_batch_id        uuid references ingest_batches(id)
);
create unique index state_of_mind_subject_hk_uuid_key
  on state_of_mind (subject_id, hk_uuid) where hk_uuid is not null;
create unique index state_of_mind_subject_second_key
  on state_of_mind (subject_id, source_id, kind, (date_trunc('second', start_ts at time zone 'UTC')));
create index state_of_mind_subject_start on state_of_mind (subject_id, start_ts desc);
