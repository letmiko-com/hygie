# Hygie

Self-hosted web dashboard for Apple Health data: workouts, sleep, records, trends and every
HealthKit metric, on a real screen instead of a phone.

**Status: in production for its author** (7M+ measurements, 14 years of history, 96 metric
types), pre-1.0 for everyone else: it works, but the self-hosting guide is still being
written. Open source under AGPL-3.0; a paid iOS companion app (Hygie Sync) will fund the
project once it reaches the App Store.

## What it does

- **Fully flexible time navigation**: any window from 24 hours to all-time, period-over-period
  comparison, minute/hour/day granularity picked from the window width. All state in the URL.
- **Dashboard, workouts, sleep, records, explorer, full metrics catalog**: every metric type
  present in the database gets a reference page (statistics true to its aggregation semantics,
  raw measurements included). Records are replayed against the full history: a displayed
  record is a proven one.
- **Two ingestion channels, deduplicated**: streaming XML import of the native Apple Health
  `export.zip` for the past (runs locally, never through HTTP), continuous push from the
  iPhone for what comes next, through [Health Auto Export](https://www.healthyapps.dev/) or
  the first-party Hygie Sync app (HealthKit at the source, background delivery).
- **Hourly rollups** for deep history, raw data for the present; both read paths proven equal
  point by point across time zones. p95 budget of 500 ms, held on 7M rows.
- **Multi-account by design, never open signup**: a household where each member sees only
  their own data and the admin sees none of it. Magic-link auth, per-device API keys.
- **Encrypted off-platform backups**: `pg_dump` streamed into [age](https://age-encryption.org/)
  toward a public key; the private key never exists on the server. Restore rehearsed for real.

## Design principles

- **No health data in this repo, ever.** No fixtures from real exports, no screenshots with
  real values, no sample dumps. Synthetic data only.
- **No secrets in code or history.** All configuration through environment variables. `.env*`
  is git-ignored; `.env.example` documents the contract.
- **No data ≠ zero**, everywhere: a day without measurements is shown as such, never as an
  invented zero.
- **Trends are first-class** and color encodes the quality of a trend, not its direction:
  a falling resting heart rate is good news, a moving magnesium intake is not an opinion.
- **The database is reconstructible.** Raw detail is kept, rollups are derived and rebuildable.

## Stack

Next.js (App Router, standalone output) + PostgreSQL, one Dockerfile for the reference
deployment (Railway) and self-hosters alike. Forward-only SQL migrations (`npm run migrate`),
never run automatically at boot. Read `docs/architecture.md` first: it is the contract.

## Self-hosting

The short version, until the guide exists: PostgreSQL 16+, `cp .env.example .env` and fill it,
`npm run migrate && npm run seed`, build and run the Dockerfile (or `npm run build && npm start`).
Backfill your history with `npm run backfill -- export.zip --subject <uuid>`, then
`npm run rollups -- --subject <uuid>`. Open an issue if you get stuck: real-world reports are
exactly what pre-1.0 needs.

## License

[AGPL-3.0](./LICENSE). Self-host it, modify it, share it; if you serve a modified version to
others, publish your changes.
