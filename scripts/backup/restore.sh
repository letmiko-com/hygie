#!/bin/sh
# Hygie restore drill / disaster recovery.
#
# Run this OFF the hosting platform, on a machine that holds the private key.
# It decrypts an encrypted dump and restores it into a target database, then
# prints the row counts that make a restore verifiable rather than hopeful.
#
# Usage:
#   HYGIE_BACKUP_KEYFILE=~/hygie-backup.key \
#   ./restore.sh hygie-20260804T031500Z.dump.age postgres://user:pw@host/hygie_restore
#
# The target database must exist and should be empty. Nothing here ever touches a
# production connection string by accident: the target is an explicit argument.

set -eu

ARCHIVE="${1:?usage: restore.sh <archive.age> <target-database-url>}"
TARGET="${2:?usage: restore.sh <archive.age> <target-database-url>}"
: "${HYGIE_BACKUP_KEYFILE:?HYGIE_BACKUP_KEYFILE (age private key file) is required}"

case "$TARGET" in
  *hygie_prod*|*railway*) echo "refusing: target looks like production" >&2; exit 1 ;;
esac

PLAIN="$(mktemp -t hygie-restore.XXXXXX)"
trap 'rm -f "$PLAIN"' EXIT

age --decrypt --identity "$HYGIE_BACKUP_KEYFILE" --output "$PLAIN" "$ARCHIVE"
pg_restore --no-owner --no-privileges --dbname "$TARGET" "$PLAIN"

echo "--- restore verification ---"
psql "$TARGET" -tAc "
  select 'users            ' || count(*) from users
  union all select 'subjects         ' || count(*) from subjects
  union all select 'devices          ' || count(*) from devices
  union all select 'observations     ' || count(*) from observations
  union all select 'minute_stats     ' || count(*) from minute_stats
  union all select 'workouts         ' || count(*) from workouts
  union all select 'workout_routes   ' || count(*) from workout_route_points
  union all select 'sleep_segments   ' || count(*) from sleep_segments
  union all select 'rollup_hourly    ' || count(*) from rollup_hourly
  union all select 'ingest_batches   ' || count(*) from ingest_batches
  union all select 'coverage         ' || coalesce(min(start_ts)::date::text,'-') || ' -> ' || coalesce(max(start_ts)::date::text,'-') from observations
"

# A restore must not resurrect revoked access: sessions and device keys from the
# dump are valid again the moment the database is up. Kill them here, in the drill
# as in a real recovery, then re-pair devices deliberately.
psql "$TARGET" -qc "delete from auth_sessions; delete from auth_verification_tokens;"
echo "sessions and pending magic links cleared on the restored copy"
echo "reminder: re-apply the tombstone registry (purged subjects, revoked device keys) before serving this copy"
