# Hygie

Self-hosted web dashboard for Apple Health data: workouts, sleep, nutrition, records, on a real screen instead of a phone.

**Status: early development, not usable yet.** Private for now, built to be open-sourceable from the first commit.

## What it does (target)

- Ingests Apple Health data through [Health Auto Export](https://www.healthyapps.dev/) (JSON push to a REST endpoint) for continuous sync.
- Backfills history from the native Apple Health `export.zip` (streaming XML import, runs locally, never through HTTP).
- Stores everything in Postgres: compact observations, workouts, sleep phases, rebuildable rollups.
- Serves 24h / 7d / 1m / 6m views and all-time records (distance, duration, speed) through a Next.js app.

## Design principles

- **No health data in this repo, ever.** No fixtures from real exports, no screenshots with real values, no sample dumps. Synthetic data only.
- **No secrets in code or history.** All configuration through environment variables. `.env*` is git-ignored; `.env.example` documents the contract.
- **Single-user by design.** Magic-link email auth with a closed allowlist. Not a SaaS.
- **The database is reconstructible.** Raw detail is kept, rollups are derived, backups are encrypted and stored off-platform.

## Stack

Next.js (standalone) + Postgres, deployed on Railway. Auth.js magic links over custom SMTP. Ingestion authenticated by a dedicated API key, idempotent by design (stable observation keys, upserts only).

## License

Not decided yet. All rights reserved until the project is opened.
