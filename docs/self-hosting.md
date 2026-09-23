# Self-hosting Hygie

The README takes you from an empty server to your first chart. This guide covers what
comes after: putting the instance behind HTTPS, making login work, backing up, updating,
and replacing the phone that feeds it.

It assumes Docker and PostgreSQL 16+. Railway is one deployment among others and gets no
special treatment here; where a hosting platform changes something, it is called out.

## 1. The reverse proxy

Hygie listens on port 3000 and never terminates TLS. Something in front of it must.

**TLS is a requirement, not a recommendation.** Hygie Sync refuses a plain `http://`
server address, so a LAN instance without a certificate cannot be paired at all.

### The one setting that silently breaks login

`HYGIE_BASE_URL` must match the scheme your users actually reach, because the session
cookie is derived from it (`src/lib/auth/session.ts`):

| `HYGIE_BASE_URL` | Cookie name | `Secure` attribute |
|---|---|---|
| `https://hygie.example.com` | `__Secure-hygie.session-token` | yes |
| `http://localhost:3000` | `hygie.session-token` | no |

If the proxy serves HTTPS while `HYGIE_BASE_URL` still says `http://`, the browser
receives a cookie without the `__Secure-` prefix over a secure origin and the session
never sticks: you request a magic link, click it, and land back on `/login` with no error
message. The reverse mismatch fails the same way. Set the canonical public URL and
restart the app after changing it.

### What the proxy does not need to do

- **No `X-Forwarded-Host` gymnastics.** Auth.js is told where it lives: `AUTH_URL` is
  derived from `HYGIE_BASE_URL` at startup (`src/auth.ts`), so the app never sniffs the
  `Host` header to build callback URLs.
- **No security headers.** The app already sends Content-Security-Policy, HSTS,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options` and a
  `Permissions-Policy` on every response (`next.config.ts`). Adding a second CSP at the
  proxy does not harden anything: browsers enforce the intersection of both policies, and
  a well-meaning duplicate is the usual reason a page stops rendering.

### What it does need to do

Forward the `/api/v1/ingest/*` routes without buffering. Health payloads are streamed
straight to disk by the route handlers rather than held in memory, and a proxy that
buffers the whole request first defeats that and can reject large batches on its own.

A minimal nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name hygie.example.com;

    # your certificate directives here

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Ingest batches and Health exports are large and streamed.
        client_max_body_size 0;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
}
```

Caddy needs no equivalent tuning for the common case:

```caddyfile
hygie.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## 2. SMTP

**There are no passwords in Hygie.** Login is by magic link, so an instance without a
working SMTP relay is an instance nobody can log into, including you. Set this up before
you need it: the bootstrap admin account is useless until mail leaves the server.

| Variable | Notes |
|---|---|
| `SMTP_HOST` | Any provider. |
| `SMTP_PORT` | `.env.example` defaults to `2587`, which gets through from Railway Hobby; `587` is the usual choice elsewhere. |
| `SMTP_USER`, `SMTP_PASSWORD` | Relay credentials. |
| `SMTP_FROM` | Must be an address the relay is allowed to send as, e.g. `"Hygie <hygie@example.com>"`. A sender the provider rejects looks exactly like a working configuration until the first link never arrives. |

The same relay carries the silence alert: when a paired device has sent nothing for
`HYGIE_SILENCE_ALERT_HOURS` (default `24`, `0` turns it off), the members of its subject
and every admin get one email, and the next batch re-arms it. A broken relay therefore
also means a phone can stop sending without anyone being told.

`HYGIE_MAIL_CAPTURE_DIR` writes the messages to disk as JSON instead of sending them.
It exists for development and tests. Never set it in production: it turns every login
into a file on the server.

The first account comes from `HYGIE_BOOTSTRAP_ADMIN_EMAIL`, which only applies while the
database has no user. Remove the variable after the first login.

How magic links are hardened (single use, expiry, no account-existence oracle, rate
limiting) is described in `docs/architecture.md` §5.

## 3. Backups

The tooling lives in `scripts/backup/`, and its own
[README](../scripts/backup/README.md) documents the key model, the variables, the restore
procedure and a drill measured on a real 7 M observation dataset. Read it before the first
run. What follows is what an operator needs to decide, and the part people get wrong.

### What is backed up, and what is not

`dump.sh` takes a `pg_dump` of the database, encrypts it to an `age` public key and
uploads it to S3-compatible storage. That is the entire scope. **Not** in the backup:

- **`HYGIE_DATA_DIR`** (`/data` in the image): the raw ingest bodies under `ingest/` and
  the tile cache. The database holds every parsed measurement, so a restore loses no
  health data, but the raw bodies kept for reprocessing are gone.
- **Your environment variables.** `AUTH_SECRET`, the database URL, the SMTP credentials
  and `HYGIE_BACKUP_PUBKEY` are not in the dump. Keep them wherever you keep secrets; a
  database you can restore into an instance you cannot reconfigure is half a recovery.
- **The `age` private key**, by design. It is generated off the server and never uploaded.
  Lose it and every backup you hold is unreadable. This is the trade for a server that
  cannot read its own backups.

### Scheduling

Nothing is scheduled for you. The job runs in its own image, `Dockerfile.backup` (the app
image has no `pg_dump`, `age` or S3 client), once per invocation. A nightly cron on the
Docker host is enough:

```sh
docker build -f Dockerfile.backup -t hygie-backup .
15 3 * * * docker run --rm --network <network-of-the-database> --env-file /etc/hygie/backup.env hygie-backup
```

On Railway, a second service on the same repository builds `Dockerfile.backup` on a cron
schedule; `scripts/backup/README.md` lists its settings. Set `HYGIE_BACKUP_HEARTBEAT_URL`
to a heartbeat monitor: a nightly job that silently stops is the failure nobody notices.

Two behaviours worth knowing before you trust the job:

- It **refuses to upload a dump under 1 MB** and exits non-zero. A backup that looks
  successful and contains nothing is worse than a visible failure.
- It **deletes nothing remotely**. Retention is a bucket lifecycle rule, not a script
  option. Scope the storage credentials to write-only on that bucket while you are there:
  a backup job never needs to read, and a write-only key cannot exfiltrate the archive it
  just wrote.

Rehearse a restore with `restore.sh` on a scratch database before you invite a second
member, and again after any migration that changes storage shape. A restore that has
never been tried is a hope, not a backup.

## 4. Updating and migrations

Migrations are forward-only, and they **never run at boot**. The container entrypoint says
so explicitly and drops privileges without touching the schema: applying them is your
decision, not a side effect of a restart.

The order that works:

1. Build or pull the new image.
2. Apply the migrations with that new image.
3. Replace the running container.

```sh
docker build -t hygie .
docker exec hygie sh -c 'cd /app && NODE_PATH=/app/node_modules node scripts/migrate.mjs'
docker restart hygie
```

From a checkout with `DATABASE_URL` set, the same step is `npm run migrate`.

What the runner does: each `db/migrations/NNNN_name.sql` file is applied in lexical order,
each in its own transaction, and recorded in `schema_migrations`. Already-applied files
are skipped, so re-running it is safe and is the normal way to check you are up to date.
A `pg_advisory_lock` makes concurrent runs harmless.

**There is no rollback.** Forward-only means exactly that: a migration you regret is
undone by restoring a backup, which is one more reason for section 3 to be in place first.

If you restart the app before migrating, the new code meets the old schema and the pages
that depend on the new tables fail. Migrate first, restart second.

## 5. Replacing the phone

This one bites silently, so it is worth understanding before it happens.

For cumulative types, exactly one device is authoritative per subject and type. That
authority is bootstrapped by the **first device ever seen** and never moves on its own
(`docs/architecture.md` §2). A replacement iPhone is therefore non-authoritative forever:
every minute it sends is recorded in `minute_conflicts` and nothing is written to
`minute_stats`. Nothing errors, nothing warns, and the charts simply stop advancing. That
is a real incident, on 2026-08-14, found two days later.

Run the cutover when you replace the companion device, whether that is a new phone or a
switch from Health Auto Export to Hygie Sync:

```sh
node scripts/cutover.mjs --device "<new device name>"   # dry run, prints before → after
node scripts/cutover.mjs --device "<new device name>" --yes
```

From a checkout, `npm run cutover`. It moves `channel_cutovers.device_id` for every
cutover of that device's subject, in one transaction, and reports how many conflicting
minutes are already waiting.

What it deliberately does not do:

- It does not touch `cutover_ts`. Only the timestamp participates in the truth rules, so
  moving authority alone invalidates no rollup: **you do not need to rebuild rollups
  afterwards.**
- It does not rewrite `minute_stats.device_id` on existing rows. Provenance stays as
  written.
- It does not promote the conflicts recorded while the new device was not authoritative.
  The app re-emits recent minutes by itself; an older gap is a backfill matter.

## What this guide does not cover

- **Running more than one instance** against the same database. Hygie assumes a single
  instance; nothing here has been tested otherwise.
- **Retention and lifecycle policies** on your object storage, which are configured at the
  provider, not in Hygie.
- **Importing history and pairing devices**, which are steps 4 and 5 of the README, and
  the later-export rules that go with them.

Something missing or wrong here is worth an issue: pre-1.0 needs the reports of people who
actually ran it somewhere other than the author's server.
