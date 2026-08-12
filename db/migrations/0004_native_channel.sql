-- Native ingestion channel (hygie-native/1, docs/native-format.md): HealthKit
-- UUIDs give samples an exact identity. Nullable columns (no table rewrite on
-- 7.2M rows); the partial unique indexes start empty and only ever carry
-- native-channel rows. Uniqueness is per subject: two subjects could in
-- theory sync stores that exchanged data.

alter table observations add column hk_uuid uuid;
alter table sleep_segments add column hk_uuid uuid;

create unique index observations_subject_hk_uuid_key
  on observations (subject_id, hk_uuid) where hk_uuid is not null;
create unique index sleep_segments_subject_hk_uuid_key
  on sleep_segments (subject_id, hk_uuid) where hk_uuid is not null;
