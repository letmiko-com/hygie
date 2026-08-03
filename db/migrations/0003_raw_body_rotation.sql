-- 0003: rotation of the raw ingest bodies (expand only, backward compatible).
--
-- purge_after has been written on every batch since day one but never applied.
-- raw_purged_at records that the compressed body is gone: the file is deleted
-- first, the row stamped after, so a crash in between simply retries. The batch
-- row itself (checksums, counts, status, error) is kept forever for audit.
-- The partial index is the purge scan: it only ever sees batches still holding
-- a body.

alter table ingest_batches add column if not exists raw_purged_at timestamptz;

create index if not exists ingest_batches_purge_idx
  on ingest_batches (purge_after) where raw_purged_at is null;
