-- Hygie — draft schema (design artifact; real DDL will live in versioned migrations).
-- Revised after adversarial review round 4 (2026-08-02): provenance and quantized values
-- on observations, device authority for cumulatives, external workout identity, Auth.js
-- tables with explicit naming, analytic timezone on subjects, worker claim protocol.
-- Conventions: all timestamps timestamptz (UTC) + original local offset in minutes where
-- the source provides one. Every health-data table carries subject_id. ON DELETE CASCADE
-- is an integrity net only: member purge runs in batches, background, table by table.

create extension if not exists citext;

-- identity -----------------------------------------------------------------
-- Naming: "users" is the person who signs in; auth_* tables belong to the Auth.js
-- adapter (written explicitly, never generated implicitly).

create table users (
  id           uuid primary key default gen_random_uuid(),
  email        citext unique not null,
  display_name text not null,
  is_admin     boolean not null default false,
  locale       text not null default 'fr',        -- UI language (interface concern)
  unit_system  text not null default 'metric' check (unit_system in ('metric','imperial')),
  week_start   smallint not null default 1 check (week_start between 1 and 7),
  created_at   timestamptz not null default now(),
  disabled_at  timestamptz
);

create table auth_sessions (               -- DB sessions: immediate revocation is real
  token       text primary key,            -- hashed session token
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table auth_verification_tokens (    -- magic link tokens, consumed via POST page
  identifier  citext not null,             -- email
  token       text not null,               -- hashed
  expires_at  timestamptz not null,
  primary key (identifier, token)
);

create table subjects (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  timezone     text not null default 'Europe/Paris', -- IANA; cuts days/nights/rollups
  created_at   timestamptz not null default now(),
  purge_state  text not null default 'live' check (purge_state in ('live','revoked','purging','purged'))
);
-- Tombstone registry lives OUTSIDE the main backup set so a restore cannot resurrect
-- a purged member (re-applied after any restore; see architecture.md).

create table access_grants (
  user_id    uuid not null references users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  role       text not null check (role in ('owner')),  -- future: 'guardian', 'viewer'
  primary key (user_id, subject_id)
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
  revoked_at   timestamptz              -- devices are revoked, never deleted (audit)
);

-- taxonomy ------------------------------------------------------------------

create table units (
  id   smallint generated always as identity primary key,
  name text unique not null              -- 'kcal', 'kJ', 'count/min', '%', 'fraction', ...
);

create table metric_types (
  id             smallint generated always as identity primary key,
  hk_identifier  text unique not null,   -- canonical vocabulary = HealthKit identifiers
  kind           text not null check (kind in ('quantity','category')),
  hae_regime     text not null default 'unsupported'
    check (hae_regime in ('raw_discrete','minute_cumulative','daily_summary','unsupported')),
  aggregation    text not null default 'none'
    check (aggregation in ('sum','average','duration','latest','none')),
  canonical_unit_id smallint references units(id),
  quantize_scale integer,                -- value_key = round(value * scale); per type
  supported      boolean not null default false,  -- Hygie knows how to ingest it
  check (kind <> 'quantity' or canonical_unit_id is not null)
);

create table metric_category_values (    -- the enum contract for category kinds
  type_id   smallint not null references metric_types(id),
  raw_value smallint not null,           -- what observations.category_value stores
  slug      text not null,               -- stable: 'asleep_deep', 'stand_hour_idle', ...
  hk_value  text not null,               -- HealthKit's own constant, the raw reference
  primary key (type_id, raw_value),
  unique (type_id, slug)
);

create table subject_metric_settings (   -- CNIL: sensitive categories are opt-in per subject
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  ingest     boolean not null,
  primary key (subject_id, type_id)
);

create table sources (
  id   smallint generated always as identity primary key,
  name text unique not null              -- normalized: U+00A0 -> space; composites verbatim
);

create table source_priorities (         -- per-type source ranking for raw-channel truth
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  source_id  smallint not null references sources(id),
  rank       smallint not null,
  primary key (subject_id, type_id, source_id)
);

-- raw channel (XML backfill + HAE discrete types) ----------------------------

create table import_runs (               -- one row per XML backfill execution
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references subjects(id) on delete cascade,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  importer_version text not null,
  source_sha256 bytea not null,          -- checksum of export.xml
  counts       jsonb,
  status       text not null default 'running' check (status in ('running','done','failed'))
);

create table observations (
  id              bigint generated always as identity primary key,
  subject_id      uuid not null references subjects(id) on delete cascade,
  type_id         smallint not null references metric_types(id),
  source_id       smallint not null references sources(id),
  start_ts        timestamptz not null,
  end_ts          timestamptz,           -- null for HAE points (no end in the JSON)
  value           double precision,      -- quantity kinds, canonical unit (for queries)
  value_key       bigint,                -- quantized identity: round(value * quantize_scale)
  category_value  smallint,              -- category kinds; contract in metric_category_values
  tz_offset_min   smallint not null check (tz_offset_min between -900 and 900),
  origin          text not null check (origin in ('health_xml','hae')),
  original_unit_id smallint references units(id),
  ingest_batch_id uuid,                  -- set when origin = 'hae'
  import_run_id   uuid references import_runs(id), -- set when origin = 'health_xml'
  ingested_at     timestamptz not null default now(),
  check (end_ts is null or end_ts >= start_ts),
  check ((value is null) <> (category_value is null)),
  check (value is null or (value = value and abs(value) <> 'infinity'::float8))  -- no NaN/inf
);
-- created after bulk backfill, not before:
-- create index on observations (subject_id, type_id, start_ts);
-- Dedup rules: exact within one origin (subject, type, source, start_ts, value_key);
-- the ±1s tolerance applies ONLY to one-to-one XML<->HAE matching at ingestion
-- (multiset matching in a staging table, ambiguous groups quarantined, never silent drops).

-- minute channel (HAE cumulatives, Apple-deduplicated) ------------------------

create table minute_stats (
  subject_id      uuid not null references subjects(id) on delete cascade,
  type_id         smallint not null references metric_types(id),
  minute_ts       timestamptz not null check (minute_ts = date_trunc('minute', minute_ts)),
  value           double precision not null,  -- canonical unit
  source_id       smallint not null references sources(id), -- provenance, mutable on upsert
  device_id       uuid not null references devices(id),     -- the authoritative writer
  ingest_batch_id uuid not null,
  updated_at      timestamptz not null default now(),
  primary key (subject_id, type_id, minute_ts)  -- one Apple truth per minute; NOT per source
);

create table minute_conflicts (          -- non-authoritative device sent a different value
  subject_id  uuid not null,
  type_id     smallint not null,
  minute_ts   timestamptz not null,
  device_id   uuid not null,
  value       double precision not null,
  seen_at     timestamptz not null default now(),
  primary key (subject_id, type_id, minute_ts, device_id)
);

create table channel_cutovers (
  subject_id uuid not null references subjects(id) on delete cascade,
  type_id    smallint not null references metric_types(id),
  cutover_ts timestamptz not null check (cutover_ts = date_trunc('minute', cutover_ts)),
  device_id  uuid not null references devices(id),  -- authoritative device for cumulatives
  primary key (subject_id, type_id)
);
-- Invariants (documented in architecture.md): raw < cutover <= minute; cutover is
-- monotone and never moves backward automatically; missing HAE data after cutover is a
-- gap, never a fallback to XML; moving a cutover invalidates rollups on the moved range.

-- workouts -------------------------------------------------------------------

create table workouts (
  id             uuid primary key default gen_random_uuid(),  -- Hygie identity, immutable
  subject_id     uuid not null references subjects(id) on delete cascade,
  activity_type  text not null,           -- HKWorkoutActivityType*
  source_id      smallint not null references sources(id),
  start_ts       timestamptz not null,
  end_ts         timestamptz not null check (end_ts > start_ts),
  tz_offset_min  smallint not null,
  is_indoor      boolean,
  duration_s     double precision not null check (duration_s >= 0),
  distance_m     double precision check (distance_m >= 0),
  energy_kj      double precision check (energy_kj >= 0),
  elevation_up_m double precision,
  stats          jsonb not null default '{}' -- verified aggregates only (never HAE recovery HR)
);
-- Matching XML<->HAE uses a NON-unique fingerprint index (heuristic, not identity):
create index workouts_fingerprint on workouts (subject_id, activity_type, start_ts, end_ts, source_id);

create table workout_external_ids (      -- stable external identities, per namespace
  workout_id  uuid not null references workouts(id) on delete cascade,
  namespace   text not null,             -- 'hae', 'healthfit_fit', ...
  external_id text not null,
  primary key (namespace, external_id, workout_id),
  unique (workout_id, namespace)
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
  stage         smallint not null,   -- contract in metric_category_values (SleepAnalysis)
  start_ts      timestamptz not null,
  end_ts        timestamptz not null check (end_ts >= start_ts),
  tz_offset_min smallint not null
);

create table sleep_daily (           -- both channels kept; a view picks the authoritative one
  subject_id  uuid not null references subjects(id) on delete cascade,
  night_date  date not null,         -- in night_timezone below
  channel     text not null check (channel in ('derived','hae')),
  night_timezone text not null,      -- tz used at computation time (subject tz may change)
  asleep_s    integer, core_s integer, deep_s integer, rem_s integer,
  awake_s     integer, in_bed_s integer,
  sleep_start timestamptz, sleep_end timestamptz,
  primary key (subject_id, night_date, channel)
);

-- rollups (derived, rebuildable) -------------------------------------------------
-- Hourly UTC; daily views aggregate full hours and compute the two partial edge hours
-- from raw, so half-hour timezones stay exact.

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

create table rollup_dirty_ranges (   -- invalidation queue: cutover moves, upserted minutes...
  id         bigint generated always as identity primary key,
  subject_id uuid not null,
  type_id    smallint not null,
  from_ts    timestamptz not null,
  to_ts      timestamptz not null,
  queued_at  timestamptz not null default now()
);

-- ingestion ----------------------------------------------------------------------
-- File-first protocol: body written to a temp name, fsync, atomic rename, THEN the row
-- is inserted; boot-time reconciliation handles orphan files and rowless files.

create table ingest_batches (
  id                uuid primary key default gen_random_uuid(),
  device_id         uuid not null references devices(id),  -- no cascade: audit survives revocation
  subject_id        uuid not null references subjects(id) on delete cascade,
  received_at       timestamptz not null default now(),
  automation_id     uuid,                  -- HAE header
  session_id        uuid,                  -- HAE header: groups batches of one export run
  upload_complete   boolean,               -- HAE structured header
  body_bytes        bigint not null,
  body_sha256       bytea not null,
  raw_path          text not null,         -- compressed body on the data volume
  purge_after       date not null,         -- received_at + 30 days
  format_version    text not null,         -- canonical ingest format version
  adapter_version   text not null,         -- HAE adapter version used
  declared_range    tstzrange,             -- detected or declared time bounds of the batch
  status            text not null default 'received'
    check (status in ('received','validated','normalized','rollups_ready','failed')),
  status_updated_at timestamptz not null default now(),
  attempt_count     smallint not null default 0,
  locked_by         text,                  -- worker claim (FOR UPDATE SKIP LOCKED + lease)
  locked_until      timestamptz,
  started_at        timestamptz,
  normalized_at     timestamptz,
  finished_at       timestamptz,
  error             jsonb,
  counts            jsonb                  -- points ingested / skipped / deduped / conflicts, per type
);
