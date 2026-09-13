#!/bin/sh
set -eu
cd /app
mkdir -p "$(dirname "$PERCH_DB_PATH")" "$PERCH_UPLOAD_DIR"
if [ -z "${PERCH_R2_BUCKET:-}" ]; then
  echo "R2 is not configured; starting without Litestream"
  exec bun apps/server/src/index.ts
fi
if [ "${PERCH_RESTORE_FROM_R2:-false}" = "true" ]; then
  echo "restoring from R2"
  litestream restore -config /app/litestream.yml -if-db-not-exists "$PERCH_DB_PATH"
  bun apps/server/scripts/restoreUploads.ts
fi
exec litestream replicate -config /app/litestream.yml -exec "bun apps/server/src/index.ts"
