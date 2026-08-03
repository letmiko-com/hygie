# Off-platform encrypted backups

Railway volume snapshots and Postgres PITR protect against operational mistakes, but
they live in the same account as the data and disappear with the volume. This is the
independent copy: an `age`-encrypted `pg_dump` pushed to S3-compatible storage, which
the hosting platform can write but never read.

## Key model

The dump is encrypted to a **public** key. The private key is generated on a machine
that is not the server, stored in 1Password, and never uploaded anywhere. Consequences,
in plain terms: an attacker holding the Railway environment or the storage credentials
gets ciphertext; losing the private key means losing every backup. Both are deliberate.

```sh
age-keygen -o hygie-backup.key      # run this on a laptop, not on the server
grep 'public key:' hygie-backup.key # -> HYGIE_BACKUP_PUBKEY (safe to put in Railway)
# store hygie-backup.key in 1Password ("Letmiko"), then delete the local file
```

## Configuration (Railway service variables)

| Variable | Value |
|---|---|
| `HYGIE_BACKUP_PUBKEY` | the `age1...` recipient printed above |
| `HYGIE_BACKUP_S3_BUCKET` | bucket name |
| `HYGIE_BACKUP_S3_ENDPOINT` | e.g. `https://s3.fr-par.scw.cloud` |
| `HYGIE_BACKUP_S3_REGION` | e.g. `fr-par` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | credentials scoped to **write-only on this bucket** |
| `HYGIE_BACKUP_PREFIX` | optional key prefix, default `hygie` |

Scope the credentials to object creation on this bucket only. A backup job never needs
to read, and a write-only key cannot be used to exfiltrate the archive it just wrote.
Set a lifecycle rule on the bucket for retention (e.g. keep 30 daily, 12 monthly);
`dump.sh` deliberately does not delete anything remotely.

## Running

Manually, from the app container:

```sh
railway ssh --service app -- 'cd /app && sh scripts/backup/dump.sh'
```

Scheduled: a Railway cron service on the same repo with
`sh scripts/backup/dump.sh` as its start command. Railway crons are UTC, the minute is
not guaranteed, and a run is skipped if the previous one is still going: all fine for a
nightly dump.

The dump streams `pg_dump | age` so the plaintext never lands on disk, and the job
refuses to upload anything under 1 MB, because a backup that looks successful and
contains nothing is worse than a failure.

## Restoring, and the drill

`restore.sh` is run **off** the platform, on the machine holding the private key:

```sh
HYGIE_BACKUP_KEYFILE=~/hygie-backup.key \
  ./restore.sh hygie-20260804T031500Z.dump.age postgres://user:pw@localhost/hygie_drill
```

It decrypts, restores, prints the row counts and coverage window that make a restore
verifiable, then **clears sessions and pending magic links** on the copy: a restore must
not resurrect access that was revoked. Re-apply the tombstone registry (purged subjects,
revoked device keys) before serving a restored copy, and re-pair devices deliberately.

A drill is not optional. Measured on the real dataset (6.5 M observations, 2026-08-04):

| Step | Time | Size |
|---|---|---|
| `pg_dump \| age` | 18 s | 98 MB encrypted |
| decrypt + `pg_restore` into an empty database | 53 s | 7 199 305 observations, 963 workouts, 18 304 sleep segments, coverage 2012-12-25 → 2026-08-03, identical to source |

Repeat the drill after any schema migration that changes storage shape, and before
inviting a second member to the instance.
