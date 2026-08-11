# Hygie — Architecture

Status: design frozen for the vertical slice, informed by three adversarial reviews and by
measurements on real data (7.17M observations benchmarked; real Health Auto Export payloads
cross-checked against the Apple Health XML export). Update this document when a decision
changes; the reasoning behind decisions lives in the project log, not here.

## 1. Identity model: accounts, subjects, grants, devices

A **subject** owns health data. An **account** authenticates (magic link email). An
**access grant** links an account to a subject with a role. A **device** pushes data for
exactly one subject and authenticates with its own API key.

- Day one: one account = one subject via an `owner` grant. Adults only; dependent profiles
  (minors) are out of scope until a parental-authority model is designed.
- The instance admin (flag on account) manages accounts, invitations, and sees per-subject
  sync state. The admin has NO applicative read access to health data. This boundary is
  structural (enforced in the query layer, which requires a subject context derived from
  the session's grants), not a setting. It is applicative honesty, not cryptography: whoever
  controls Postgres can read everything.
- Deleting a member = revoke sessions, device keys, and grants immediately (data becomes
  unreachable), then a background job physically purges rows and raw files, verifiably.
  Restores from backup must not resurrect revoked keys: a tombstone registry (purged subjects, revoked keys) is stored outside the main backup set and re-applied after any restore. Purge runs table by table in batches; ON DELETE CASCADE is an integrity net, not the purge algorithm.

## 2. Data channels: the two-regime rule

Measured fact: Health Auto Export (HAE) JSON carries two different kinds of series, and the
XML backfill carries raw records. They must never be merged into one series.

| Channel | Content | Dedup |
|---|---|---|
| `raw` (XML backfill, and HAE discrete types) | Raw samples: heart rate, HRV, SpO2, respiratory rate, walking metrics, temperatures, ... | Exact within one origin on (type, normalized source, ts, quantized value_key). One-to-one XML↔HAE matching is applied in BOTH directions at write time — HAE ingestion refuses points matching existing XML rows (normalize-hae), the XML backfill refuses rows matching existing HAE observations (import-xml ≥ 0.2.0) — so whichever channel reaches the database second has its duplicates dropped and counted (multiset matching, ambiguous groups quarantined, never silent drops). Match window: ±1s, plus the measured HAE truncation rule — HAE truncates seconds to :00 for every raw type except heart_rate (hae-mapping.md), so a minute-aligned HAE point matches an XML timestamp in [ts, ts+60s). Two raw types are per-minute RE-AGGREGATIONS on the HAE side (physical_effort, time_in_daylight — see hae-mapping.md) where no line-level match is possible: they follow the interval rule instead, the channel that covered a range first owns it. A discrete measurement therefore exists at most once, whatever channels carried it; history written before these guards is repaired by `scripts/backfill/dedup-channels.mjs` |
| `minute` (HAE cumulative types) | Per-minute aggregates already deduplicated by Apple (steps, active/basal energy, distance, stand/exercise time) | None vs raw; idempotent vs re-emissions by unique (subject, type, minute) |

Cutover invariants: the raw→minute transition is monotone and never reverts automatically; exactly one device is authoritative for cumulatives per (subject, type) (recorded on the cutover; a non-authoritative device sending a different value creates a logged conflict, never a silent overwrite); missing HAE data after the cutover is a gap, never a fallback to XML; moving a cutover invalidates rollups on the affected range. Per (subject, type) there is a **channel cutover timestamp** (raw < cutover ≤ minute): before it, truth comes from
the XML backfill (raw records, Apple-style dedup computed by us at query time per source
priority); after it, cumulative truth comes from the HAE minute channel (Apple's own
deduplicated totals — this is what the Santé app displays, which resolves the metric-truth
requirement for cumulatives). Discrete types have no such split: raw everywhere.

Reconciliation gate before trusting any analytic view: daily totals per type compared
against Apple Santé's displayed numbers on sample days, with a tolerated epsilon.

## 3. Ingestion pipeline

The Next.js server is a persistent Node process on Railway (not serverless), so the worker
is an in-process loop; no third service.

1. `POST /api/v1/ingest/hae` — device key checked (hash compare) BEFORE reading the body;
   applicative size cap; body streamed to disk (`/data/ingest/`), never parsed in the
   request path. Row inserted in `ingest_batches` with status `received`, HTTP 200 only
   after both are durable. Response carries `batch_id`.
2. Worker loop (in-process, interval + on-boot recovery): `received → validated →
   normalized → rollups_ready | failed`. Claim protocol: atomic claim (FOR UPDATE SKIP
   LOCKED + lease with `locked_until`), one transaction per step, status updated only
   after the matching commit, advisory lock per subject/type, no new claims after
   SIGTERM. Bodies are written temp-name → fsync → atomic rename → row insert; boot
   reconciles orphan files and rowless rows. A Railway redeploy mid-normalization
   simply expires the lease and the next process replays idempotently.
3. Normalization: HAE name → HK identifier mapping (31 verified entries, see
   `docs/hae-mapping.md`); unit conversion driven by the payload's `units` field (never
   assumed: kJ vs kcal, % vs fraction); source-name normalization (U+00A0 → space;
   composite sources like `A|B` kept verbatim as synthetic sources); timestamps parsed
   with their explicit local offset, stored as UTC + offset. Known field traps: workout
   `avgHeartRate`/`maxHeartRate` are recovery values (2 min post-workout) — ignored;
   blood pressure arrives fused (split into the two HK types); HAE `sleep_analysis` is a
   daily summary (stored in `sleep_daily`, distinct from raw `sleep_segments`).
4. Raw bodies are kept compressed 30 days, replayable. Rotation runs in the worker's
   hourly maintenance: for settled batches (`rollups_ready`/`failed`) past `purge_after`
   the file is deleted first, then the row is stamped `raw_purged_at` — a crash in
   between just retries, a missing file counts as done. The batch row survives forever
   (checksums, counts, status): rotation frees bytes, never audit trail. A batch still
   in flight keeps its body whatever its age.
5. Sync status endpoint distinguishes "batch received" from "data visible"
   (status ≥ `normalized`).

The XML backfill is a local CLI (streaming, COPY-based; 7.17M rows imported in 91s on the
bench), never HTTP. Sequence: minimal schema → bulk import → validation/reconciliation →
secondary indexes → first full backup → then enable PITR.

## 4. Query layer and rollups

- One composite index `(subject_id, type_id, start_ts)` on `observations` (no table partitioning at this volume) covers
  all time navigation (measured: every dashboard query < 200 ms on real data). Additional
  indexes only on evidence (~200 MB each).
- Rollups serve wide windows only. The read layer picks its source per query on the WIDTH of
  the window: at or below 31 days the sources answer (measured: single-digit ms), above it the
  closed history is summed from `rollup_hourly` (measured, all-time heart rate: 1774 ms and
  42 560 buffers raw → 75 ms and 1 092). 31 days is where the two paths cross on the densest
  and the most channel-heavy series; the exact value is a plateau, not a cliff.
  Hourly UTC rollups; daily views aggregate full hours and compute the two partial edge hours
  from raw, so half-hour timezones stay exact — and the sources-only path deduplicates
  cumulatives per (UTC hour, local day) for the same reason, so a day does not change value
  with the width of the window it is read through. Today (from local midnight in the subject's
  zone) is always read from the sources: a batch is visible at `normalized` and rolled up at
  `rollups_ready`. Rollups are derived and rebuildable, never the source of truth.
- `rollup_hourly` is built by one SQL function, `rollup_rebuild_range(subject, type,
  from, to)` (migration 0002), which applies the same truth rules as the read layer
  (two-regime rule, one winning source per UTC hour before the cutover) and is used by
  both the worker and the rebuild script, so the two cannot drift.
- Invalidation is exact and transactional: whoever writes a source row queues the UTC
  hours it touched in `rollup_dirty_ranges` **inside the same transaction** (committed
  write ⟺ committed invalidation). Deriving the hours from a batch's `declared_range`
  would recompute untouched hours and still miss the ones a cutover invalidates outside
  it. The worker drains its batch's ranges before the batch reaches `rollups_ready`, and
  drains everyone else's when idle. Category types are never rolled up (no numeric value);
  `min`/`max` are meaningful for raw types only.
- Bulk writes that bypass the worker (XML backfill, hand-moved cutover) invalidate
  nothing on their own: the operator runs `npm run rollups -- --subject <uuid>`
  afterwards (idempotent, one transaction per month per type).
- p95 budget for dashboard queries: 500 ms, re-verified with EXPLAIN ANALYZE when the
  schema evolves.

## 5. Auth and security

- Auth.js magic link over SMTP (custom relay, port 2587 from Railway). POST-confirmation
  page so mailbox link scanners cannot consume tokens. No public signup: the first admin
  is created by a one-time bootstrap (CLI or env var), members by admin invitation
  afterwards. Sessions live in the database (immediate revocation must be real; no
  self-contained JWT).
- Device API keys: random, shown once, stored hashed, revocable, one per device per
  subject. Separate secret universe from user sessions.
- No health values, payloads, or secrets in logs. Ingestion logs metadata only (batch id,
  counts, sizes, checksums, redacted errors). Rate limiting on ingestion; CSP strict;
  cross-subject leak tests are part of the test suite.
- Data minimization (CNIL): default ingest allowlist covers the product's types; ECG,
  symptoms, medications, reproductive data are opt-in per subject. Unknown types are
  recorded in the taxonomy but not ingested automatically.
- AGPL: the UI carries a "Source" link.

## 6. Backups

Railway volume snapshots + Postgres PITR (first line of defense) AND a scheduled encrypted
logical dump (public-key encryption, private key held outside Railway) pushed to external
S3-compatible object storage via the private network. TCP proxy to Postgres stays disabled
outside the initial backfill window. A restore drill is mandatory before inviting a second
member. Database size alert at 3.5 GB (Hobby volume is 5 GB); the upgrade path is
documented, not improvised.

## 7. MVP scope (vertical slice)

Foundations built fully (identity model, taxonomy, time/units rules, i18n structure,
versioned ingestion format, migrations discipline: expand/contract, never auto-run at
boot). Visible product deliberately reduced: one admin+subject, XML backfill, one HAE
device, sync status screen, sport+sleep dashboard, session list and detail (no map),
simple records, preset + custom ranges. Deferred: family administration, arbitrary
period comparisons, GPS maps, nutrition, ECG, GHCR image, full Hygie Sync contract.
