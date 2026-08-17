#!/usr/bin/env bash
# Restore Postgres from a dump produced by scripts/backup.sh.
#   scripts/restore.sh [path/to/dump]      (default: newest daily dump)
# Drops and recreates the database, so STOP the web/worker replicas first in a
# real restore. See docs/runbook-backup-restore.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"
DB_NAME="${POSTGRES_DB:-vidya}"
DB_USER="${POSTGRES_USER:-vidya}"
DB_DAILY="$BACKUP_ROOT/db/daily"

DUMP="${1:-$(ls -1t "$DB_DAILY"/*.dump 2>/dev/null | head -1 || true)}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "[restore] no dump found (looked in $DB_DAILY). Pass a path explicitly." >&2
  exit 1
fi
echo "[restore] restoring $DB_NAME from $DUMP"

dc() { docker compose "$@"; }

# 1. Kick off every other connection so the DB can be dropped.
dc exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null

# 2. Recreate an empty database.
dc exec -T postgres dropdb -U "$DB_USER" --if-exists "$DB_NAME"
dc exec -T postgres createdb -U "$DB_USER" "$DB_NAME"

# 3. Restore. pg_restore loads table data (COPY) before it creates the
#    append-only triggers, so the audit trail restores without --disable-triggers.
dc exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner <"$DUMP"

echo "[restore] done."
