-- Series types of the native channel: additive sections of hygie-native/1
-- carried by Hygie Sync 1.1 (docs/native-format.md). GPS routes reuse
-- workout_route_points (0001); the three tables below are new. Expand step
-- only: nothing reads them until the screens ship, so the migration can run
-- before or after the deploy that carries it.

-- Activity rings, one row per device-calendar day (HKActivitySummary). The
-- app re-emits a sliding window on every sync and the upsert only registers
-- real changes, like the minute regime. Energy in kJ like workouts; "move"
-- is either energy or time depending on the watch's move mode.
create table activity_summaries (
  subject_id         uuid not null references subjects(id) on delete cascade,
  day                date not null,
  move_mode          text not null default 'energy' check (move_mode in ('energy', 'time')),
  move_kj            double precision check (move_kj >= 0),
  move_goal_kj       double precision check (move_goal_kj >= 0),
  move_time_min      double precision check (move_time_min >= 0),
  move_time_goal_min double precision check (move_time_goal_min >= 0),
  exercise_min       double precision check (exercise_min >= 0),
  exercise_goal_min  double precision check (exercise_goal_min >= 0),
  stand_h            double precision check (stand_h >= 0),
  stand_goal_h       double precision check (stand_goal_h >= 0),
  paused             boolean not null default false,
  source_id          smallint not null references sources(id),
  ingest_batch_id    uuid references ingest_batches(id),
  updated_at         timestamptz not null default now(),
  primary key (subject_id, day)
);

-- ECG recordings (HKElectrocardiogram): one row per 30 s trace, voltages
-- stored inline in microvolts (int16 is ample: Apple Watch lead I stays
-- within a few millivolts). hk_uuid is null for rows imported from the CSV
-- files of an Apple Health export; the per-second index is the exact
-- residual that keeps such a row and its native twin from coexisting.
create table ecg_recordings (
  id                uuid primary key default gen_random_uuid(),
  subject_id        uuid not null references subjects(id) on delete cascade,
  hk_uuid           uuid,
  source_id         smallint not null references sources(id),
  start_ts          timestamptz not null,
  end_ts            timestamptz,
  tz_offset_min     smallint not null,
  classification    text not null,
  symptoms_status   text not null default 'not_set',
  avg_hr_bpm        double precision check (avg_hr_bpm > 0),
  sampling_hz       double precision not null check (sampling_hz > 0),
  algorithm_version smallint,
  lead              text not null default 'apple_watch_similar_to_lead_i',
  n_samples         integer not null check (n_samples >= 0),
  voltages_uv       smallint[] not null,
  ingest_batch_id   uuid references ingest_batches(id)
);
create unique index ecg_recordings_subject_hk_uuid_key
  on ecg_recordings (subject_id, hk_uuid) where hk_uuid is not null;
-- date_trunc on a timestamptz depends on the session zone (stable, not
-- immutable, refused in an index); on the UTC-shifted timestamp it is exact.
create unique index ecg_recordings_subject_second_key
  on ecg_recordings (subject_id, source_id, (date_trunc('second', start_ts at time zone 'UTC')));
create index ecg_recordings_subject_start on ecg_recordings (subject_id, start_ts desc);

-- Audiograms (HKAudiogramSample): one row per test, points per ear and
-- frequency. Same identity discipline as ECGs.
create table audiograms (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references subjects(id) on delete cascade,
  hk_uuid         uuid,
  source_id       smallint not null references sources(id),
  start_ts        timestamptz not null,
  end_ts          timestamptz,
  tz_offset_min   smallint not null,
  ingest_batch_id uuid references ingest_batches(id)
);
create unique index audiograms_subject_hk_uuid_key
  on audiograms (subject_id, hk_uuid) where hk_uuid is not null;
create unique index audiograms_subject_second_key
  on audiograms (subject_id, source_id, (date_trunc('second', start_ts at time zone 'UTC')));
create index audiograms_subject_start on audiograms (subject_id, start_ts desc);

create table audiogram_points (
  audiogram_id      uuid not null references audiograms(id) on delete cascade,
  side              text not null check (side in ('left', 'right')),
  frequency_hz      double precision not null check (frequency_hz > 0),
  sensitivity_db_hl double precision not null,
  masked            boolean not null default false,
  conduction        text not null default 'air',
  clamped           text check (clamped in ('low', 'high')),
  primary key (audiogram_id, side, frequency_hz, masked)
);
