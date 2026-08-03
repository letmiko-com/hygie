#!/bin/sh
# Hygie encrypted off-platform backup.
#
# Runs inside the app container (Railway cron or manual), reaches Postgres over the
# private network, and pushes an age-encrypted dump to S3-compatible object storage.
#
# The dump is encrypted to a PUBLIC key held in HYGIE_BACKUP_PUBKEY. The matching
# private key never exists on this platform: whoever holds the storage credentials
# cannot read the backups, and neither can this container. Restoring is a deliberate
# act performed elsewhere with the private key (see restore.sh).
#
# Required environment:
#   DATABASE_URL            postgres connection string (private network)
#   HYGIE_BACKUP_PUBKEY     age recipient, e.g. age1xxxxxxxx...
#   HYGIE_BACKUP_S3_BUCKET  bucket name
#   HYGIE_BACKUP_S3_ENDPOINT  e.g. https://s3.fr-par.scw.cloud
#   HYGIE_BACKUP_S3_REGION    e.g. fr-par
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  scoped write-only credentials
# Optional:
#   HYGIE_BACKUP_PREFIX     key prefix (default: hygie)
#   HYGIE_BACKUP_KEEP_LOCAL keep the local artifact for inspection (default: no)

set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${HYGIE_BACKUP_PUBKEY:?HYGIE_BACKUP_PUBKEY is required}"
: "${HYGIE_BACKUP_S3_BUCKET:?HYGIE_BACKUP_S3_BUCKET is required}"
: "${HYGIE_BACKUP_S3_ENDPOINT:?HYGIE_BACKUP_S3_ENDPOINT is required}"

PREFIX="${HYGIE_BACKUP_PREFIX:-hygie}"
WORKDIR="${HYGIE_DATA_DIR:-/data}/backup"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="${PREFIX}-${STAMP}.dump.age"
TMP="${WORKDIR}/.${NAME}.part"
OUT="${WORKDIR}/${NAME}"

mkdir -p "$WORKDIR"
trap 'rm -f "$TMP"' EXIT

# pg_dump custom format (-Fc): compressed, parallel-restorable, and it fails loudly
# rather than truncating. Streamed straight into age so the plaintext dump never
# touches the disk.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --encrypt --recipient "$HYGIE_BACKUP_PUBKEY" --output "$TMP"

mv "$TMP" "$OUT"
SIZE=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)

# A dump smaller than a megabyte means pg_dump produced almost nothing: refuse to
# ship it, an empty backup that looks successful is worse than a failed one.
if [ "$SIZE" -lt 1048576 ]; then
  echo "backup aborted: dump is only ${SIZE} bytes, refusing to upload" >&2
  rm -f "$OUT"
  exit 1
fi

aws s3 cp "$OUT" "s3://${HYGIE_BACKUP_S3_BUCKET}/${NAME}" \
  --endpoint-url "$HYGIE_BACKUP_S3_ENDPOINT" \
  ${HYGIE_BACKUP_S3_REGION:+--region "$HYGIE_BACKUP_S3_REGION"} \
  --only-show-errors

echo "backup ok: ${NAME} size=${SIZE} sha256=${SHA}"

[ "${HYGIE_BACKUP_KEEP_LOCAL:-no}" = "yes" ] || rm -f "$OUT"
