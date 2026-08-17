#!/usr/bin/env bash
# Restore DRILL — proves the backup/restore path actually works:
#   1. snapshot per-table row counts of the live DB
#   2. back it up (scripts/backup.sh)
#   3. DESTROY the database (drop + recreate empty) and confirm it's gone
#   4. restore from the backup (scripts/restore.sh)
#   5. re-snapshot and assert every table's row count matches the original
# Exit 0 only if counts match. Run this after seeding so there's data to lose.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DB_NAME="${POSTGRES_DB:-vidya}"
DB_USER="${POSTGRES_USER:-vidya}"

dc() { docker compose "$@"; }
psql_() { dc exec -T postgres psql -U "$DB_USER" -d "$1" -At "${@:2}"; }

# Per-table COUNT(*) for every public table, as sorted `table:count` lines.
snapshot() {
  local gen
  gen="$(psql_ "$DB_NAME" -c \
    "SELECT coalesce(string_agg(format('SELECT %L t, count(*) c FROM %I.%I', tablename, schemaname, tablename), ' UNION ALL '), 'SELECT NULL t, 0 c WHERE false') FROM pg_tables WHERE schemaname='public'")"
  psql_ "$DB_NAME" -F: -c "SELECT t, c FROM ($gen) s ORDER BY t"
}
total() { awk -F: '{s+=$2} END{print s+0}'; }

echo "=== restore drill: $DB_NAME ==="
before="$(snapshot)"
before_total="$(printf '%s\n' "$before" | total)"
echo "[drill] live DB: $(printf '%s\n' "$before" | grep -c . ) tables, $before_total rows total"
if [ "$before_total" -eq 0 ]; then
  echo "[drill] FAIL: database is empty — seed it first (VIDYA_ALLOW_DEMO_SEED=true pnpm seed:demo)." >&2
  exit 1
fi

echo "[drill] --- backing up ---"
bash "$ROOT/scripts/backup.sh"

echo "[drill] --- DESTROYING database ---"
psql_ postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null
dc exec -T postgres dropdb -U "$DB_USER" "$DB_NAME"
dc exec -T postgres createdb -U "$DB_USER" "$DB_NAME"
destroyed_total="$(snapshot | total)"
echo "[drill] after destroy: $destroyed_total rows (expected 0)"
[ "$destroyed_total" -eq 0 ] || { echo "[drill] FAIL: destroy did not empty the DB." >&2; exit 1; }

echo "[drill] --- restoring ---"
bash "$ROOT/scripts/restore.sh"

after="$(snapshot)"
after_total="$(printf '%s\n' "$after" | total)"
echo "[drill] restored DB: $after_total rows total"

echo "[drill] --- comparing per-table counts ---"
if diff <(printf '%s\n' "$before") <(printf '%s\n' "$after"); then
  echo "[drill] PASS: all $(printf '%s\n' "$before" | grep -c .) tables match ($before_total rows)."
else
  echo "[drill] FAIL: row counts differ (< before, > after)." >&2
  exit 1
fi
