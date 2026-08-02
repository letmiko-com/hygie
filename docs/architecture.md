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
  Restores from backup must not resurrect revoked keys.

## 2. Data channels: the two-regime rule

Measured fact: Health Auto Export (HAE) JSON carries two different kinds of series, and the
XML backfill carries raw records. They must never be merged into one series.

| Channel | Content | Dedup |
|---|---|---|
| `raw` (XML backfill, and HAE discrete types) | Raw samples: heart rate, HRV, SpO2, respiratory rate, walking metrics, temperatures, ... | Proven exact: (type, normalized source, minute-truncated ts, canonical value); second-precision with ±1s tolerance for heart rate |
| `minute` (HAE cumulative types) | Per-minute aggregates already deduplicated by Apple (steps, active/basal energy, distance, stand/exercise time) | None vs raw; idempotent vs re-emissions by unique (subject, type, minute) |

Per (subject, type) there is a **channel cutover timestamp**: before it, truth comes from
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
   normalized → rollups_ready | failed`. Each transition is idempotent and resumable;
   a crashed step is retried from its persisted state.
3. Normalization: HAE name → HK identifier mapping (31 verified entries, see
   `docs/hae-mapping.md`); unit conversion driven by the payload's `units` field (never
   assumed: kJ vs kcal, % vs fraction); source-name normalization (U+00A0 → space;
   composite sources like `A|B` kept verbatim as synthetic sources); timestamps parsed
   with their explicit local offset, stored as UTC + offset. Known field traps: workout
   `avgHeartRate`/`maxHeartRate` are recovery values (2 min post-workout) — ignored;
   blood pressure arrives fused (split into the two HK types); HAE `sleep_analysis` is a
   daily summary (stored in `sleep_daily`, distinct from raw `sleep_segments`).
4. Raw bodies are kept compressed 30 days (rotation by `purge_after`), replayable.
5. Sync status endpoint distinguishes "batch received" from "data visible"
   (status ≥ `normalized`).

The XML backfill is a local CLI (streaming, COPY-based; 7.17M rows imported in 91s on the
bench), never HTTP. Sequence: minimal schema → bulk import → validation/reconciliation →
secondary indexes → first full backup → then enable PITR.

## 4. Query layer and rollups

- One composite index `(type_id, start_ts)` per subject partition of `observations` covers
  all time navigation (measured: every dashboard query < 200 ms on real data). Additional
  indexes only on evidence (~200 MB each).
- Rollups exist ONLY for all-time/multi-year views (measured: 1.24s raw → 107ms via hourly
  rollup). Hourly UTC rollups; daily aggregation computed in the subject's IANA timezone
  from hourly (exact for integer-offset timezones). Rollups are derived and rebuildable,
  never the source of truth.
- p95 budget for dashboard queries: 500 ms, re-verified with EXPLAIN ANALYZE when the
  schema evolves.

## 5. Auth and security

- Auth.js magic link over SMTP (custom relay, port 2587 from Railway). POST-confirmation
  page so mailbox link scanners cannot consume tokens. No public signup: accounts are
  created by admin invitation only.
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
