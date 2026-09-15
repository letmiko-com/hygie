# Hygie

**Your Apple Health data, at home, on a big screen.** Hygie is a self-hosted web
dashboard that keeps years of Apple Health data for a whole household, on a server you
own: workouts, sleep, health markers, records and trends, with fully flexible time
navigation. An instrument, not a coach.

Two promises, and everything in this repository serves them:

- **Your data stays yours.** No cloud service, no account with anyone, no telemetry. The
  iPhone pushes to your server, the browser talks to your server, even the map tiles under
  a GPS trace are fetched by your server. Nothing else ever sees a measurement.
- **A history that outlives your devices.** Phones, watches and apps change; the database
  does not. The past comes from the Apple Health export, the present arrives continuously
  from the phone, and every raw sample is kept, so any view can be rebuilt.

**Status (September 2026).** In production for its author (7M+ measurements, 14 years of
history, 96 metric types carrying data out of a catalogue of 190 HealthKit types), pre-1.0
for everyone else: it works, real-world reports are what it needs now, and the self-hosting
guide is still the section below. Open source under AGPL-3.0. The iOS companion,
[Hygie Sync](https://apps.apple.com/app/id6800605692), is on the App Store: a one-time
purchase whose price covers the Apple developer account. The server is free and stays free.
Presentation site: [hygie.letmiko.com](https://hygie.letmiko.com).

![Dashboard](docs/screenshots/dashboard-light.jpg)

## Who it is for

- **People who already self-host something** (a NAS, a small VPS, a Docker host) and want
  their health history out of the phone without handing it to a third party.
- **Households.** One instance, one account per member; each member sees only their own
  data and the instance admin sees none of it. No public sign-up, ever.
- **Not for you if** you want a readiness score, a coach or a streak. Hygie shows what the
  body measured, with its context, and leaves the interpretation to you.

## From zero to the first chart

The short path, until a full `docs/self-hosting.md` exists. You need Docker (or Node 22),
PostgreSQL 16+, an SMTP relay (login is by magic link, there are no passwords) and a domain
with HTTPS in front of the app: **the iPhone refuses plain `http://`**, so a LAN instance
without TLS cannot be paired.

1. **Configure.** `cp .env.example .env` and fill it: `DATABASE_URL`, `HYGIE_BASE_URL`
   (the public URL, magic links point there), the `SMTP_*` variables, `AUTH_SECRET`
   (`openssl rand -hex 32`), `HYGIE_DATA_DIR` (a persistent volume; `/data` in the image)
   and `HYGIE_BOOTSTRAP_ADMIN_EMAIL`, your own address.
2. **Build and run.** One image serves Railway and self-hosters alike:

   ```sh
   docker build -t hygie .
   docker run -d --name hygie --env-file .env -p 3000:3000 -v hygie-data:/data hygie
   docker exec hygie sh -c 'cd /app && NODE_PATH=/app/node_modules node scripts/migrate.mjs && node scripts/seed-taxonomy.mjs'
   ```

   Migrations are forward-only and **never run at boot**: run them yourself after every
   update, before restarting the app. Put your reverse proxy with TLS in front of port 3000.
3. **Log in.** On the first boot with an empty database, the address in
   `HYGIE_BOOTSTRAP_ADMIN_EMAIL` becomes the admin, with its own subject. Request a magic
   link on `/login`, then remove the variable: it never runs again once a user exists.
4. **Import your history.** Export from the Health app (profile picture, then Export All
   Health Data), copy `export.zip` where the scripts can read it, then run, from the
   container or from a checkout with `DATABASE_URL` set:

   ```sh
   docker cp export.zip hygie:/data/export.zip
   docker exec hygie sh -c 'cd /app && NODE_PATH=/app/node_modules \
     node scripts/backfill/import-xml.mjs /data/export.zip --subject <uuid> && \
     node scripts/backfill/import-series.mjs /data/export.zip --subject <uuid> && \
     node scripts/rebuild-rollups.mjs --subject <uuid>'
   ```

   The subject id is the `id` column of the `subjects` table (`select id, display_name
   from subjects`). The first script streams samples, sleep stages and workouts; the second
   adds the activity rings, GPS routes (GPX), ECGs (CSV) and audiograms of the same archive;
   the third rebuilds the hourly rollups, which is mandatory after **every** backfill. The
   import runs locally, never over HTTP, and refuses a file it has already imported.
5. **Pair the iPhone.** Devices, then Pair a device: copy the `hygk_…` key into Hygie Sync
   together with your instance URL. From then on every new sample reaches the server in the
   background, with its HealthKit UUID and full timestamp, and the sync page distinguishes
   "batch received" from "data visible". Health Auto Export is accepted as an alternative
   channel (`docs/hae-mapping.md`).
6. **Schedule the backups.** The server ships the tooling (`scripts/backup/`: `age`-encrypted
   `pg_dump` streamed to S3-compatible storage, restore script, drill measured on real data)
   but **schedules nothing for you**: set the `HYGIE_BACKUP_*` variables and run `dump.sh`
   from a cron. Rehearse the restore once before inviting a second member.

Later exports must not be imported whole again (the samples of the first one would be
duplicated): run `import-xml.mjs` with `--from <iso> --to <iso>` on the window the channels
missed (`--skip-minute-types` when `minute_stats` already carries it), and `import-series.mjs`
without a window, it is idempotent. When you replace the phone that feeds Hygie, run
`node scripts/cutover.mjs --device <new device name>` (dry run, then `--yes`) so the new
device becomes the authority for the minute channel; otherwise its data is logged as
conflicts and never written. From a checkout, the same scripts are `npm run migrate`,
`seed`, `backfill`, `backfill:series`, `rollups` and `cutover`.

Open an issue if you get stuck: real-world reports are exactly what pre-1.0 needs.

## What it does

- **Fully flexible time navigation**: any window from 24 hours to all-time, period-over-period
  comparison, minute/hour/day granularity picked from the window width. All state in the URL.
- **Dashboard, weekly review, calendar**: the whole picture, one week against the previous one
  (pro rata while the week is in progress), one month of sessions and nights.
- **Sport**: sessions by sport, weekly volume, heart rate zones over any window up to a quarter
  and for each session, cut from an observed maximum (highest per-session 99th percentile over
  a year) or from a maximum you declare.
- **Sleep**: nights with their stages, hourly grid, bedtime regularity, rolling trend.
- **Health markers**: HRV, resting and walking heart rate, respiratory rate, SpO₂, wrist
  temperature, breathing disturbances, VO₂ max, weight and body composition, each read over the
  window and against the previous one. No composite score: the numbers, their trend, their curve.
- **Series beyond samples**: GPS trace of every outdoor session over OpenStreetMap tiles that
  this server fetches and caches itself (the browser never talks to the tile provider, and
  `HYGIE_TILE_URL=off` gives a plain trace), activity rings on the dashboard, electrocardiograms
  on standard paper with Apple's classification, audiograms on a clinical chart, beat-to-beat
  intervals behind the HRV page, state of mind entries.
- **Records replayed against the full history**: a displayed record is a proven one, with the
  mark it replaced.
- **Explorer and full metrics catalog**: up to six metrics on one chart; every metric type present
  in the database gets a reference page (statistics true to its aggregation semantics, raw
  measurements included).
- **Hourly rollups** for deep history, raw data for the present; both read paths proven equal
  point by point across time zones. p95 budget of 500 ms, held on 7M rows.
- **Multi-account by design, never open signup**: a household where each member sees only
  their own data and the admin sees none of it. Magic-link auth, per-device API keys.
- **Encrypted off-platform backups**, shipped as scripts: `pg_dump` streamed into
  [age](https://age-encryption.org/) toward a public key; the private key never exists on the
  server. Restore rehearsed for real on the author's data.

## Feeding Hygie: three channels, one deduplicated truth

| Channel | What it carries | When |
|---|---|---|
| **Apple Health export** (`export.zip`) | The past: every sample, sleep stage and workout, plus rings, GPX routes, ECG and audiogram files. Streaming local import, never over HTTP. | Once, then only to fill a gap |
| **Hygie Sync** (iOS, App Store) | The present, in the native format `hygie-native/1` (`docs/native-format.md`): each sample with its HealthKit UUID and full timestamp, sleep stages, workouts. Since 1.1: routes, rings, ECGs, audiograms, beat-to-beat series and state of mind. Background delivery, cursors that only advance after the server acknowledged. | Continuously |
| **Health Auto Export** | Still accepted (`docs/hae-mapping.md`), with its measured limits: seconds truncated to the minute, per-minute re-aggregations, 21 of the 96 types. | If you already use it |

The server deduplicates across channels (by UUID for the native channel, by the two-regime
rule of `docs/architecture.md` §2 otherwise), so re-sending never duplicates and a channel
replaying after a cut is absorbed.

## Screenshots

Every screenshot below comes from the synthetic dataset (`npm run synthetic`, see
below): one invented person, two years of plausible measures. No real health data anywhere in
this repository.

| | |
|---|---|
| ![Health markers](docs/screenshots/markers-light.jpg) Health markers | ![Weekly review](docs/screenshots/week-light.jpg) Weekly review |
| ![Calendar](docs/screenshots/calendar-light.jpg) Calendar | ![Sport and heart rate zones](docs/screenshots/sport-light.jpg) Sport, heart rate zones |
| ![Session detail](docs/screenshots/session-light.jpg) Session detail | ![Sleep](docs/screenshots/sleep-light.jpg) Sleep |
| ![Explorer](docs/screenshots/explore-light.jpg) Explorer | ![Dashboard, dark theme](docs/screenshots/dashboard-dark.jpg) Dashboard, dark theme |

## Design principles

- **No health data in this repo, ever.** No fixtures from real exports, no screenshots with
  real values, no sample dumps. Synthetic data only.
- **No secrets in code or history.** All configuration through environment variables. `.env*`
  is git-ignored; `.env.example` documents the contract.
- **No data ≠ zero**, everywhere: a day without measurements is shown as such, never as an
  invented zero.
- **Trends are first-class** and color encodes the quality of a trend, not its direction:
  a falling resting heart rate is good news, a moving magnesium intake is not an opinion.
- **An instrument, not a coach.** No readiness score, no strain index, no advice: what the body
  shows, with its context.
- **The database is reconstructible.** Raw detail is kept, rollups are derived and rebuildable.

## Stack

Next.js (App Router, standalone output) + PostgreSQL, one Dockerfile for the reference
deployment (Railway) and self-hosters alike. Forward-only SQL migrations (`npm run migrate`),
never run automatically at boot. Read `docs/architecture.md` first: it is the contract.
`docs/native-format.md` is the wire format Hygie Sync speaks; `docs/hae-mapping.md` the
measured Health Auto Export protocol.

## Try it with synthetic data

`npm run synthetic -- --email you@example.com --yes` creates a demo subject with 400 days of
invented measures, sessions and nights (deterministic seed), then prints the `npm run rollups`
command to run next. Request a magic link for that email and you are in. For development,
set `HYGIE_MAIL_CAPTURE_DIR` and the magic-link email lands in that directory as JSON instead
of being sent. Never run it against a production database.

## Support and contributing

- **Bugs and real-world reports**: issues on this repository. A self-hosting report that
  says where you got stuck is a contribution.
- **Anything else**, including questions from App Store purchasers without a GitHub
  account: contact@letmiko.com.
- **Contributions** are welcome on the server. Hygie Sync's source is not published; its wire
  format is, in `docs/native-format.md`.

## License

[AGPL-3.0](./LICENSE). Self-host it, modify it, share it; if you serve a modified version to
others, publish your changes.
