#!/usr/bin/env bash
# Vidya update: applies a release tarball to an existing install.
#
#   bash update.sh path/to/vidya-release-X.Y.Z.tar.gz
#
# Automatic pre-update backup (aborts if it fails), image rebuild, migrations,
# health check. On a failed health check: automatic rollback to the previous
# images. See docs/update-guide.md and docs/runbook-backup-restore.md.
#
# No signature/crypto logic here either — the license/edition gate below
# shells out to scripts/license-issue.ts --verify exactly like install.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
COMPOSE_BASE=(-f docker-compose.yml -f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_BASE[@]}" "$@"; }

# --- output helpers (same shapes as install.sh, kept separate on purpose —
# these two scripts run at different times, by different people, and a
# shared sourced file is one more thing that has to ship correctly with the
# release tarball) -------------------------------------------------------
c_reset=""; c_red=""; c_green=""; c_yellow=""; c_blue=""
if [ -t 1 ]; then
  c_reset=$'\033[0m'; c_red=$'\033[31m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_blue=$'\033[34m'
fi
ok()   { printf '%s[ OK ]%s %s\n'  "$c_green"  "$c_reset" "$*"; }
warn() { printf '%s[WARN]%s %s\n'  "$c_yellow" "$c_reset" "$*" >&2; }
fail() { printf '%s[FAIL]%s %s\n'  "$c_red"    "$c_reset" "$*" >&2; }
info() { printf '%s[ .. ]%s %s\n'  "$c_blue"   "$c_reset" "$*"; }
step() { printf '\n%s== %s ==%s\n' "$c_blue" "$*" "$c_reset"; }
die()  { fail "$*"; exit 1; }

# || true on the two pipelines below: under pipefail, grep finding no match
# (var absent from .env, or an oddly-shaped package.json) would otherwise
# abort the whole script via set -e even though the downstream command
# (cut/sed) succeeds on the resulting empty input.
env_get() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true; }
env_has() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null; }
pkg_version() { grep -m1 '"version"' "$1/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true; }

TARBALL="${1:-}"
[ -n "$TARBALL" ] || die "usage: update.sh path/to/release-tarball.tar.gz"
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"

# ==============================================================================
step "1/7  Preflight"
# ==============================================================================
command -v docker >/dev/null 2>&1 || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) not found."
command -v rsync >/dev/null 2>&1 || die "rsync not found (apt install rsync) — used to apply the release tree without disturbing .env/backups/certs."
[ -f "$ENV_FILE" ] || die "no .env found at $ROOT — this looks like a fresh host, not an existing install. Run install.sh first."
ok "preflight ok"

# ==============================================================================
step "2/7  Unpack release"
# ==============================================================================
TMP_EXTRACT="$(mktemp -d)"
cleanup() { rm -rf "$TMP_EXTRACT"; }
trap cleanup EXIT
tar -xzf "$TARBALL" -C "$TMP_EXTRACT"

# Tarballs conventionally wrap contents in one top-level directory; unwrap it
# if so, otherwise use the extract root directly.
entries=("$TMP_EXTRACT"/*)
if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ]; then
  SRC_ROOT="${entries[0]}"
else
  SRC_ROOT="$TMP_EXTRACT"
fi
[ -f "$SRC_ROOT/package.json" ] && [ -f "$SRC_ROOT/docker-compose.yml" ] || \
  die "$TARBALL does not look like a Vidya release (no package.json/docker-compose.yml at its root)."

FROM_VERSION="$(pkg_version "$ROOT")"
TO_VERSION="$(pkg_version "$SRC_ROOT")"
ok "unpacked: $FROM_VERSION -> $TO_VERSION"

# ==============================================================================
step "3/7  License / edition gate"
# ==============================================================================
# This refuses a VENDOR-PERFORMED UPDATE, not app usage. An expired license
# never stops the product from running (Decision 1,
# docs/superpowers/specs/2026-08-13-license-verification-design.md) — the app
# keeps working normally either way. What's gated here is the update itself:
# it is an AMC service, and an install without a current AMC does not get one
# run automatically by this script. Uses the CURRENT tree's CLI/dependencies
# (not the new release's) since nothing has been swapped yet.
CURRENT_EDITION="$(env_get VIDYA_EDITION)"
LICENSE_PATH="$(env_get VIDYA_LICENSE_PATH)"
if [ -z "$CURRENT_EDITION" ]; then
  warn "VIDYA_EDITION not found in .env — skipping the license/edition gate (nothing to check against)."
elif [ -z "$LICENSE_PATH" ] || [ ! -f "$LICENSE_PATH" ]; then
  warn "no license on file (VIDYA_LICENSE_PATH unset or missing) — skipping the license/edition gate. An absent license does not block updates, only a confirmed expiry or edition mismatch does."
else
  LICENSE_TOKEN="$(tr -d '[:space:]' < "$LICENSE_PATH")"
  verify_output="$(npx tsx scripts/license-issue.ts --verify "$LICENSE_TOKEN" --edition "$CURRENT_EDITION" 2>&1)"
  # || true on both: "reason" only exists when kind=invalid, so on every
  # valid/grace/expired status (the common case!) that grep finds nothing —
  # under pipefail that would abort the whole script via set -e right here.
  kind="$(printf '%s' "$verify_output" | grep -o '"kind": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  reason="$(printf '%s' "$verify_output" | grep -o '"reason": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
  case "$kind" in
    invalid)
      if [ "$reason" = "edition-mismatch" ]; then
        die "refusing to perform this update: the on-file license does not match this install's edition ($CURRENT_EDITION). The app itself is unaffected and keeps running — this only blocks the vendor-performed update step. Fix the license file (VIDYA_LICENSE_PATH in .env) and re-run."
      else
        warn "on-file license does not verify (reason: $reason) — proceeding with the update anyway; this gate only blocks on a confirmed edition mismatch or expiry, not a malformed/unverifiable file."
      fi
      ;;
    expired)
      overdue="$(printf '%s' "$verify_output" | grep -o '"daysOverdue": *[0-9]*' | head -1 | grep -o '[0-9]*' || true)"
      die "refusing to perform this update: the license expired ${overdue:-an unknown number of} day(s) ago (beyond the 30-day grace window). This does NOT stop Vidya from running — every feature keeps working normally, that is deliberate product policy. It DOES mean this install is past its AMC term, and vendor-performed updates are an AMC service. Renew the license/AMC, then re-run update.sh."
      ;;
    valid|grace)
      ok "license ok for edition $CURRENT_EDITION"
      ;;
    *)
      warn "could not parse license verifier output — proceeding (this gate fails open on unparseable output, not closed, since it must never be the reason a security patch can't ship). Raw: $verify_output"
      ;;
  esac
fi

# ==============================================================================
step "4/7  Confirm"
# ==============================================================================
read -r -p "Update $FROM_VERSION -> $TO_VERSION? A backup will be taken first, then images rebuilt and the stack restarted. [y/N] " reply
[[ "$reply" =~ ^[Yy] ]] || die "aborted, nothing changed."

# ==============================================================================
step "5/7  Backup"
# ==============================================================================
# || true on both: under pipefail, ls finding no *.dump yet would abort the
# script via set -e even though wc still correctly reports 0.
before_count=$(ls -1 "$ROOT/backups/db/daily"/*.dump 2>/dev/null | wc -l || true)
if ! bash "$ROOT/scripts/backup.sh"; then
  die "pre-update backup failed — aborting before touching anything. Fix the backup path (docs/runbook-backup-restore.md) and re-run."
fi
after_count=$(ls -1 "$ROOT/backups/db/daily"/*.dump 2>/dev/null | wc -l || true)
[ "$after_count" -gt "$before_count" ] || die "backup.sh exited 0 but produced no new dump file — treating as a failed backup. Aborting before touching anything."
ok "pre-update backup verified: $(ls -1t "$ROOT/backups/db/daily"/*.dump | head -1)"

# ==============================================================================
step "6/7  Apply, migrate, restart"
# ==============================================================================
# Compose v2's default name for a service with no explicit `image:` key is
# <project>-<service> (verified against this repo's own compose files:
# `docker compose config --images web` resolves to `atlas-web` here — note
# that command prints the WHOLE dependency subgraph, not just one service, so
# it's not usable as a per-service lookup and isn't used for that here).
PROJECT="$(echo "${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}" | tr '[:upper:]' '[:lower:]')"
WEB_IMAGE="${PROJECT}-web:latest"
WORKER_IMAGE="${PROJECT}-worker:latest"
info "tagging current images for rollback..."
for image in "$WEB_IMAGE" "$WORKER_IMAGE"; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker tag "$image" "${image}-rollback"
  fi
done
ok "rollback tags set (${WEB_IMAGE}-rollback, ${WORKER_IMAGE}-rollback)"

info "applying release files (leaving .env, backups/, certs/, .git/ untouched)..."
rsync -a \
  --exclude '.env' --exclude 'backups/' --exclude 'certs/' --exclude '.git/' \
  "$SRC_ROOT"/ "$ROOT"/
ok "release files applied"

GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA

info "rebuilding and running migrations..."
dc up -d --build migrate
migrate_exit="$(dc ps -a --format '{{.Name}} {{.ExitCode}}' | awk '/migrate/ {print $2; exit}' || true)"
if [ "$migrate_exit" != "0" ]; then
  fail "migrations failed (exit ${migrate_exit:-unknown})."
  die "web/worker were NOT touched — the app is still running the old version ($FROM_VERSION). Release files on disk are now $TO_VERSION though, so this is a stopped-mid-update state: fix the migration (docker compose ${COMPOSE_BASE[*]} logs migrate), then re-run update.sh — it will re-apply the same files and retry migrate. No rollback needed since nothing user-facing changed."
fi
ok "migrations applied"

rollback() {
  fail "rolling back web/worker to the pre-update images..."
  restored=false
  if docker image inspect "${WEB_IMAGE}-rollback" >/dev/null 2>&1; then
    docker tag "${WEB_IMAGE}-rollback" "$WEB_IMAGE"
    restored=true
  fi
  if docker image inspect "${WORKER_IMAGE}-rollback" >/dev/null 2>&1; then
    docker tag "${WORKER_IMAGE}-rollback" "$WORKER_IMAGE"
    restored=true
  fi
  if [ "$restored" != true ]; then
    fail "no rollback image tags were found (step 6 never captured any — this install may not have had prior images). web/worker are being recreated on whatever images are currently tagged, which are likely the broken new ones. Manual recovery needed: see docs/runbook-backup-restore.md."
  fi
  dc up -d --force-recreate --no-deps web worker
  cat <<ROLLBACK >&2

ROLLED BACK: web/worker are back on the $FROM_VERSION images.

IMPORTANT — what this rollback did and did NOT do:
  - It restored the PREVIOUS APPLICATION IMAGES only.
  - It did NOT undo the migration that ran in step 6. If that migration
    changed the schema in a way the old ($FROM_VERSION) code cannot handle,
    the app may still misbehave even on the old images.
  - If so, the only clean fix is a full data restore from the pre-update
    backup taken in step 5 above: see docs/runbook-backup-restore.md
    ("Restore procedure (real incident)"). The dump from just before this
    update is the newest one in backups/db/daily/.
  - Release files on disk under $ROOT are still the NEW ($TO_VERSION) ones
    (only the running images were rolled back) — re-running update.sh from
    the same tarball is safe and idempotent once the underlying problem is
    fixed.
ROLLBACK
}

info "starting web/worker on the new images..."
dc up -d --build web worker
info "waiting for the app to report healthy..."
healthy=false
for i in $(seq 1 30); do
  if dc exec -T web node -e "fetch('http://127.0.0.1:3000/api/v1/system/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done
if [ "$healthy" != true ]; then
  fail "app did not become healthy within 60s on the new images."
  rollback
  exit 1
fi
ok "app is healthy on the new images"

# ==============================================================================
step "7/7  Done"
# ==============================================================================
echo
echo "  $FROM_VERSION -> $TO_VERSION  (git $GIT_SHA)"
echo
echo "Rollback image tags (${WEB_IMAGE}-rollback, ${WORKER_IMAGE}-rollback) were left in place as a safety net until the next update."
