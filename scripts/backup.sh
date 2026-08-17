#!/usr/bin/env bash
# Nightly backup: Postgres logical dump + MinIO bucket mirror, with retention.
# Run from a cron entry on the Docker host, or as a compose sidecar. Idempotent.
# See docs/runbook-backup-restore.md for the cron line and restore procedure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- config (override via env) ----------------------------------------------
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"
DB_NAME="${POSTGRES_DB:-vidya}"
DB_USER="${POSTGRES_USER:-vidya}"
S3_BUCKET="${S3_BUCKET:-vidya}"
MINIO_USER="${MINIO_ROOT_USER:-local-dev-only-minio}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-local-dev-only-minio-secret}"
DAILY_KEEP="${DAILY_KEEP:-7}"
WEEKLY_KEEP="${WEEKLY_KEEP:-4}"
# Compose network the throwaway mc container joins to reach `minio:9000`.
PROJECT="$(echo "${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}" | tr '[:upper:]' '[:lower:]')"
COMPOSE_NET="${COMPOSE_NET:-${PROJECT}_default}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DB_DAILY="$BACKUP_ROOT/db/daily"
DB_WEEKLY="$BACKUP_ROOT/db/weekly"
OBJ_MIRROR="$BACKUP_ROOT/minio/$S3_BUCKET"
mkdir -p "$DB_DAILY" "$DB_WEEKLY" "$OBJ_MIRROR"

dc() { docker compose "$@"; }

echo "[backup] postgres dump ($DB_NAME) ..."
# Custom format (-Fc): compressed + selective pg_restore. -T (no TTY) so the
# byte stream is clean for redirection.
dump="$DB_DAILY/$DB_NAME-$STAMP.dump"
dc exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc >"$dump"
echo "[backup]   -> $dump ($(du -h "$dump" | cut -f1))"

# Weekly snapshot on Sundays (date +%u == 7): a hard-link/copy promoted to the
# weekly set so a bad daily can't silently roll off all history.
if [ "$(date +%u)" = "7" ]; then
  cp "$dump" "$DB_WEEKLY/$DB_NAME-$STAMP.dump"
  echo "[backup]   -> promoted to weekly set"
fi

echo "[backup] minio bucket mirror ($S3_BUCKET) ..."
# mc runs in a throwaway container on the compose network. --overwrite --remove
# keeps the mirror an exact current snapshot of the bucket (artifacts are
# re-derivable; the DB dump above is the point-in-time crown jewel).
# MSYS_NO_PATHCONV stops Git Bash on Windows rewriting the container-side
# `/backup` path; a no-op on Linux/macOS cron hosts.
MSYS_NO_PATHCONV=1 docker run --rm --network "$COMPOSE_NET" \
  -e "MC_HOST_minio=http://${MINIO_USER}:${MINIO_PASS}@minio:9000" \
  -v "$OBJ_MIRROR:/backup" \
  minio/mc mirror --overwrite --remove "minio/${S3_BUCKET}" /backup \
  || echo "[backup]   WARN: bucket empty or mc failed (non-fatal)"

# --- retention: keep newest N in each set -----------------------------------
prune() { # dir keep
  local dir="$1" keep="$2" old
  # mapfile via process substitution: an empty set (ls exits nonzero) can't
  # trip pipefail/set -e here, unlike a bare `ls | tail` pipeline.
  local files=()
  mapfile -t files < <(ls -1t "$dir"/*.dump 2>/dev/null)
  for old in "${files[@]:$keep}"; do
    echo "[backup]   prune $(basename "$old")"
    rm -f "$old"
  done
}
prune "$DB_DAILY" "$DAILY_KEEP"
prune "$DB_WEEKLY" "$WEEKLY_KEEP"

echo "[backup] done. daily=$(ls -1 "$DB_DAILY"/*.dump 2>/dev/null | wc -l) weekly=$(ls -1 "$DB_WEEKLY"/*.dump 2>/dev/null | wc -l)"
