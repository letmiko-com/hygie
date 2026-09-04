-- Per-subject settings that are not measures. First one: a declared maximum
-- heart rate, used by the zone accounting instead of the observed maximum
-- (queries/zones.ts) when present. One row per subject, created on first
-- write; no row means nothing declared. Expand step only: nothing reads this
-- table until the next release, so the migration can run before or after the
-- deploy that carries it.
create table subject_settings (
  subject_id  uuid primary key references subjects(id) on delete cascade,
  max_hr_bpm  smallint check (max_hr_bpm between 100 and 230),
  updated_at  timestamptz not null default now()
);
