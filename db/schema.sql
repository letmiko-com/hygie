-- Hygie — draft schema (design artifact; real DDL will live in versioned migrations).
-- Conventions: all timestamps timestamptz (UTC) + original local offset in minutes where
-- the source provides one. Every health-data table carries subject_id. Cascades from
-- subjects are ON DELETE CASCADE, but member deletion goes through revoke-then-purge.

create extension if not exists citext;

-- identity -----------------------------------------------------------------

create table accounts (
  id           uuid primary key default gen_random_uuid(),
  email        citext unique not null,
  display_name text not null,
  is_admin     boolean not null default false,
  locale       text not null default 'fr',        -- UI language
  timezone     text not null default 'Europe/Paris', -- IANA, cuts days and nights
  unit_system  text not null default 'metric' check (unit_system in ('metric','imperial')),
  week_start   smallint not null default 1,       -- 1 = monday
  created_at   timestamptz not null default now(),
  disabled_at  timestamptz
);

create table subjects (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at   timestamptz not null default now(),
  purge_state  text not null default 'live' check (purge_state in ('live','revoked','purging','purged'))
);

create table access_grants (
  account_id uuid not null references accounts(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  role       text not null check (role in ('owner')),  -- future: 'guardian', 'viewer'
  primary key (account_id, subject_id)
);

create table devices (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references subjects(id) on delete cascade,
  name         text not null,
  platform     text,
  key_hash     bytea not null,          -- sha256 of the API key; key shown once at pairing
  key_prefix   text not null,           -- first chars, for display ("hygk_ab12…")
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

-- taxonomy ------------------------------------------------------------------

create table metric_types (
  id             smallint generated always as identity primary key,
  hk_identifier  text unique not null,   -- canonical vocabulary = HealthKit identifiers
  kind           text not null check (kind in ('quantity','category')),
  canonical_unit text not null,          -- one unit per type, converted at ingestion
  ingested       boolean not null default false  -- CNIL allowlist: false = known, not stored
);

create table sources (
  id   smallint generated always as identity primary key,
  name text unique not null              -- normalized: U+00A0 -> space; composites verbatim
);

-- raw channel (XML backfill + HAE discrete types) ----------------------------

create table observations (
  id             bigint generated always as identity primary key,
  subject_id     uuid not null references subjects(id) on delete cascade,
  type_id        smallint not null references metric_types(id),
  source_id      smallint not null references sources(id),
  start_ts       timestamptz not null,
  end_ts         timestamptz,            -- null for HAE points (no end in the JSON)
  value          double precision,       -- quantity kinds, in canonical unit
  category_value smallint,               -- category kinds (sleep stage, stand hour...)
  tz_offset_min  smallint not null
);
-- created after bulk backfill, not before:
-- create index on observations (subject_id, type_id, start_ts);
-- dedup within the raw channel (re-emissions): the ingester checks candidate keys with
-- minute truncation (+/-1s for heart rate) before insert; no unique constraint because
-- the tolerance rule cannot be expressed as one.

-- minute channel (HAE cumulatives, Apple-deduplicated) ------------------------

create table minute_stats (
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  minute_ts  timestamptz not null,
  value      double precision not null,  -- canonical unit
  source_id  smallint not null references sources(id), -- often a composite source
  primary key (subject_id, type_id, minute_ts)
);

create table channel_cutovers (
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  cutover_ts timestamptz not null,       -- before: XML/raw is truth; after: minute channel
  primary key (subject_id, type_id)
);

-- workouts -------------------------------------------------------------------

create table workouts (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references subjects(id) on delete cascade,
  activity_type text not null,           -- HKWorkoutActivityType*
  source_id     smallint not null references sources(id),
  start_ts      timestamptz not null,
  end_ts        timestamptz not null,
  tz_offset_min smallint not null,
  is_indoor     boolean,
  duration_s    double precision not null,
  distance_m    double precision,
  energy_kj     double precision,
  elevation_up_m double precision,
  stats         jsonb not null default '{}', -- verified aggregates only (never HAE recovery HR)
  hae_uuid      uuid unique,             -- HAE's workout id (absent from XML)
  unique (subject_id, activity_type, start_ts, end_ts, source_id)  -- XML<->JSON match key
);

create table workout_points (
  workout_id uuid not null references workouts(id) on delete cascade,
  series     text not null,              -- 'heart_rate', 'active_energy', 'step_count', ...
  ts         timestamptz not null,
  value      double precision not null,
  primary key (workout_id, series, ts)
);

create table workout_route_points (
  workout_id uuid not null references workouts(id) on delete cascade,
  ts         timestamptz not null,
  lat        double precision not null,
  lon        double precision not null,
  altitude_m double precision,
  speed_ms   double precision,
  course_deg double precision,
  h_acc_m    double precision,
  primary key (workout_id, ts)
);

-- sleep ------------------------------------------------------------------------

create table sleep_segments (        -- raw stages, from the XML backfill
  id            bigint generated always as identity primary key,
  subject_id    uuid not null references subjects(id) on delete cascade,
  source_id     smallint not null references sources(id),
  stage         smallint not null,   -- enum: inBed, asleepCore, asleepDeep, asleepREM, awake, unspecified
  start_ts      timestamptz not null,
  end_ts        timestamptz not null,
  tz_offset_min smallint not null
);

create table sleep_daily (           -- HAE daily summaries + derivable from segments
  subject_id  uuid not null references subjects(id) on delete cascade,
  night_date  date not null,         -- in the subject's timezone
  asleep_s    integer, core_s integer, deep_s integer, rem_s integer,
  awake_s     integer, in_bed_s integer,
  sleep_start timestamptz, sleep_end timestamptz,
  channel     text not null check (channel in ('derived','hae')),
  primary key (subject_id, night_date)
);

-- rollups (derived, rebuildable) -------------------------------------------------

create table rollup_hourly (
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  hour_utc   timestamptz not null,
  n          integer not null,
  sum        double precision not null,
  min        double precision not null,
  max        double precision not null,
  primary key (subject_id, type_id, hour_utc)
);

-- ingestion ----------------------------------------------------------------------

create table ingest_batches (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references devices(id) on delete cascade,
  received_at     timestamptz not null default now(),
  automation_id   uuid,                  -- HAE header
  session_id      uuid,                  -- HAE header: groups batches of one export run
  upload_complete boolean,               -- HAE structured header
  body_bytes      bigint not null,
  body_sha256     bytea not null,
  raw_path        text not null,         -- compressed body on the data volume
  purge_after     date not null,         -- received_at + 30 days
  status          text not null default 'received'
    check (status in ('received','validated','normalized','rollups_ready','failed')),
  error           jsonb,
  counts          jsonb                  -- points ingested / skipped / deduped, per type
);
