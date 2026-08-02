#!/bin/sh
set -e
# Make the data volume writable by the app user, then drop privileges.
DATA_DIR="${HYGIE_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/ingest"
chown -R node:node "$DATA_DIR" 2>/dev/null || true
# Migrations are NEVER run automatically here (expand/contract discipline):
# run them explicitly with `npm run migrate` (Railway pre-deploy command or manually).
exec su-exec node "$@"
