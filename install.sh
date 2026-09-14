#!/usr/bin/env bash
# Vidya on-premise installer. Interactive, idempotent — safe to re-run.
#
#   bash install.sh
#
# Companion docs: docs/install-guide.md (full walkthrough + troubleshooting),
# docs/deployment-checklist.md (env var reference), docs/runbook-backup-restore.md.
#
# What this does NOT do: build a release tarball (that is a separate
# packaging step), build container images from source (they are shipped —
# docker load for an offline bundle, docker compose pull for a registry one,
# see step 4/8), or reimplement license signature checking — step 4 runs
# scripts/license-issue.ts --verify inside a throwaway container from the
# already-obtained worker image and reads its output; there is no crypto
# logic in this file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
COMPOSE_BASE=(-f docker-compose.yml -f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_BASE[@]}" "$@"; }

# --- output helpers ----------------------------------------------------------
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

# --- .env helpers (idempotence lives here) -----------------------------------
env_get() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true; } # || true: pipefail would otherwise abort the whole script (set -e) on a plain "not found"
env_has() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null; }
env_set_once() { # name value — no-op if already present, so re-runs never clobber
  if env_has "$1"; then return 0; fi
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}
env_set_if_blank() { # name value — fills a key that is ABSENT or PRESENT-BUT-EMPTY
  # Why this exists next to env_set_once: env_has matches "^NAME=", which is
  # true for a key that is present but empty. install.sh's own .env starts
  # from `touch` so it is empty and env_set_once is fine there — but
  # .env.template ships "VIDYA_LICENSE=" empty, so an operator who copied the
  # template to .env first would get a silent no-op from env_set_once.
  # A key with a real value is still never clobbered.
  local name="$1" value="$2"
  if grep -q "^$name=[[:space:]]*$" "$ENV_FILE" 2>/dev/null; then
    # Safe unquoted/undelimited: the only caller passes a licence token,
    # which is base64url + "." — no |, &, \, or newline.
    sed -i "s|^$name=[[:space:]]*$|$name=$value|" "$ENV_FILE"
  elif ! env_has "$name"; then
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}
ensure_secret() { # name — generates only if absent; NEVER echoes the value
  local name="$1"
  if env_has "$name"; then
    info "  $name already set in .env — leaving unchanged"
  else
    printf '%s=%s\n' "$name" "$(openssl rand -hex 24)" >> "$ENV_FILE"
    ok "  $name generated"
  fi
}

# ==============================================================================
step "1/8  Preflight"
# ==============================================================================
# OS check — informational, not fatal: the target is Ubuntu 24, other distros
# may work but are untested.
if [ -r /etc/os-release ]; then
  . /etc/os-release
  if [ "${ID:-}" = "ubuntu" ] && [[ "${VERSION_ID:-}" == 24.* ]]; then
    ok "OS: ${PRETTY_NAME:-ubuntu $VERSION_ID}"
  else
    warn "OS: ${PRETTY_NAME:-unknown} — this installer targets Ubuntu 24; proceeding anyway"
  fi
else
  warn "cannot read /etc/os-release — unknown OS, proceeding anyway"
fi

# Docker + compose plugin.
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found."
  read -r -p "Install Docker now via the official convenience script (get.docker.com)? [y/N] " reply
  if [[ "$reply" =~ ^[Yy] ]]; then
    if [ "$(id -u)" -eq 0 ]; then
      curl -fsSL https://get.docker.com | sh
    else
      curl -fsSL https://get.docker.com | sudo sh
    fi
  else
    die "Docker is required. Install it (https://docs.docker.com/engine/install/) and re-run."
  fi
fi
command -v docker >/dev/null 2>&1 || die "Docker install did not succeed — install manually and re-run."
ok "docker: $(docker --version)"

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose (v2 plugin) not found. It ships with the official convenience script; install it and re-run."
fi
ok "docker compose: $(docker compose version --short 2>/dev/null || docker compose version)"

# Ports 80/443 free — Caddy is the only thing allowed to bind them (prod overlay).
port_busy() { # port -> 0 if something is listening
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
  return 1
}
ports_ok=true
for p in 80 443; do
  if port_busy "$p"; then
    fail "port $p is already in use — Caddy needs it. Common cause: apache2/nginx or another web server already running. See docs/install-guide.md troubleshooting."
    ports_ok=false
  else
    ok "port $p is free"
  fi
done
[ "$ports_ok" = true ] || die "free the busy port(s) above and re-run."

# Disk space (docs/install-guide.md: 100 GB target for up to 2,000 students).
avail_gb=$(( $(df --output=avail -k . | tail -1) / 1024 / 1024 ))
if [ "$avail_gb" -lt 20 ]; then
  die "only ${avail_gb} GB free on $ROOT's filesystem — need at least 20 GB (100 GB recommended)."
elif [ "$avail_gb" -lt 100 ]; then
  warn "only ${avail_gb} GB free — recommended is 100 GB for up to 2,000 students. Proceeding."
else
  ok "disk: ${avail_gb} GB free"
fi

# Memory (docs/install-guide.md: 8 GB target, 4 GB hard floor).
mem_gb=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 / 1024 ))
if [ "$mem_gb" -lt 4 ]; then
  die "only ${mem_gb} GB RAM — need at least 4 GB (8 GB recommended)."
elif [ "$mem_gb" -lt 8 ]; then
  warn "only ${mem_gb} GB RAM — recommended is 8 GB. Proceeding."
else
  ok "memory: ${mem_gb} GB"
fi

cores="$(nproc 2>/dev/null || echo 1)"
[ "$cores" -ge 4 ] && ok "cpu: ${cores} cores" || warn "cpu: ${cores} cores — recommended is 4"

# ==============================================================================
step "2/8  Configuration"
# ==============================================================================
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

if env_has SITE_ADDRESS && env_has VIDYA_EDITION && env_has ACME_EMAIL; then
  SITE_ADDRESS="$(env_get SITE_ADDRESS)"
  VIDYA_EDITION="$(env_get VIDYA_EDITION)"
  ADMIN_EMAIL="$(env_get ACME_EMAIL)"
  info "using existing configuration from .env: SITE_ADDRESS=$SITE_ADDRESS edition=$VIDYA_EDITION — delete .env to reconfigure from scratch"
else
  read -r -p "Institution domain (e.g. erp.yourcollege.edu), or leave blank for LAN-only: " SITE_ADDRESS_INPUT
  if [ -z "$SITE_ADDRESS_INPUT" ]; then
    SITE_ADDRESS="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    [ -n "$SITE_ADDRESS" ] || SITE_ADDRESS="localhost"
    info "LAN-only mode: serving on $SITE_ADDRESS with a self-signed certificate"
    TLS_MODE="lan"
  else
    SITE_ADDRESS="$SITE_ADDRESS_INPUT"
    TLS_MODE="internet"
  fi

  VIDYA_EDITION=""
  while [ "$VIDYA_EDITION" != "college" ] && [ "$VIDYA_EDITION" != "school" ]; do
    read -r -p "Edition [college/school]: " VIDYA_EDITION
  done

  read -r -p "Admin contact email (used for Let's Encrypt + as the account to reach ops): " ADMIN_EMAIL
  while [ -z "$ADMIN_EMAIL" ]; do
    read -r -p "Admin contact email (required): " ADMIN_EMAIL
  done

  env_set_once SITE_ADDRESS "$SITE_ADDRESS"
  env_set_once VIDYA_EDITION "$VIDYA_EDITION"
  env_set_once ACME_EMAIL "$ADMIN_EMAIL"
  env_set_once TRUSTED_ORIGINS "https://$SITE_ADDRESS"
  if [ "${TLS_MODE:-lan}" = "internet" ]; then
    env_set_once TLS_DIRECTIVE ""
  else
    env_set_once TLS_DIRECTIVE "tls internal"
  fi
fi
ok "domain=$SITE_ADDRESS edition=$VIDYA_EDITION admin-email=$ADMIN_EMAIL"

# ==============================================================================
step "3/8  Secrets"
# ==============================================================================
# openssl rand -hex (not -base64): DATABASE_URL/REDIS_URL below are built by
# naive string interpolation (postgres://user:PASS@host/db) — base64 can emit
# '/' or '@' which breaks that URL; hex is always URL-safe. Still "openssl
# rand", not a homegrown generator.
ensure_secret POSTGRES_PASSWORD
env_set_once MINIO_ROOT_USER "vidya-prod" # not secret — just non-default, per docs/deployment-checklist.md
ensure_secret MINIO_ROOT_PASSWORD
# "Session secret": this app keeps sessions server-side in Redis with no
# client-side signing secret (SessionManager is the human-owned core) — the
# nearest real thing is Redis AUTH. docker-compose.yml consumes this twice:
# the redis service runs `redis-server --requirepass ${REDIS_PASSWORD}` and
# the app's REDIS_URL is redis://:${REDIS_PASSWORD}@redis:6379.
ensure_secret REDIS_PASSWORD
chmod 600 "$ENV_FILE"

# ==============================================================================
step "4/8  Images & license verification"
# ==============================================================================
# Images are shipped, never built here: an offline bundle carries
# images/*.tar.gz (docker load below), a registry bundle relies on
# `docker compose pull`. No --build fallback — a silent fallback to
# building from source on the client is exactly the problem this removes
# (npm registry access, minutes of CPU on a modest box, a bundle that has
# to carry the whole source tree). See
# docs/assignments/a12-part1-bundle-leak-finding.md.
# docker-compose.yml resolves web/worker/migrate's `image:` key to
# ${VIDYA_IMAGE_REGISTRY:-}vidya-{service}:${VIDYA_IMAGE_TAG:-latest} — both
# unset by default, so the target name is vidya-{service}:latest unless an
# operator has pinned a registry/tag in .env.
IMAGE_TAG="$(env_get VIDYA_IMAGE_TAG)"; IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_REGISTRY="$(env_get VIDYA_IMAGE_REGISTRY)"
BUNDLE_VERSION="$(grep -m1 '"version"' "$ROOT/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)"
IMAGES_DIR="$ROOT/images"

if compgen -G "$IMAGES_DIR/*.tar.gz" >/dev/null 2>&1; then
  info "offline bundle detected ($IMAGES_DIR) — loading image tarballs..."
  for f in "$IMAGES_DIR"/*.tar.gz; do
    info "  docker load < $(basename "$f")"
    gunzip -c "$f" | docker load
  done
  # build-release.sh --offline tags the app images vidya-{web,worker,migrate}:
  # <version> — retag what shipped onto exactly the name docker-compose.yml
  # expects (see comment above) so compose finds it without a pull.
  for svc in web worker migrate; do
    src="vidya-${svc}:${BUNDLE_VERSION}"
    if docker image inspect "$src" >/dev/null 2>&1; then
      docker tag "$src" "${IMAGE_REGISTRY}vidya-${svc}:${IMAGE_TAG}"
    fi
  done
  ok "images loaded from offline bundle"
else
  info "no images/ directory in this bundle — trying \`docker compose pull\`..."
  dc pull || warn "docker compose pull reported errors above — checking what's actually available locally next"
fi

missing=()
for svc in web worker migrate; do
  ref="${IMAGE_REGISTRY}vidya-${svc}:${IMAGE_TAG}"
  docker image inspect "$ref" >/dev/null 2>&1 || missing+=("$ref")
done
if [ "${#missing[@]}" -gt 0 ]; then
  die "no usable image(s) for: ${missing[*]}. This installer never builds images on the client. Re-run from a bundle that includes an images/ directory (offline install, docker load), or set VIDYA_IMAGE_REGISTRY/VIDYA_IMAGE_TAG in .env to point web/worker/migrate at a reachable registry image so \`docker compose pull\` can fetch them."
fi
ok "images present: ${IMAGE_REGISTRY}vidya-web:${IMAGE_TAG}, ${IMAGE_REGISTRY}vidya-worker:${IMAGE_TAG}, ${IMAGE_REGISTRY}vidya-migrate:${IMAGE_TAG}"

# Black-box only: this step runs scripts/license-issue.ts --verify inside a
# throwaway container built from the worker image just obtained above
# (--no-deps, so no other service is started — this still runs before any
# service exists) and reads its JSON output. No signature/crypto logic
# lives in this file.
if env_has VIDYA_LICENSE_PATH; then
  LICENSE_PATH="$(env_get VIDYA_LICENSE_PATH)"
  info "using license path from .env: $LICENSE_PATH"
else
  read -r -p "Path to your license file [./license.json]: " LICENSE_PATH_INPUT
  LICENSE_PATH="${LICENSE_PATH_INPUT:-./license.json}"
fi
[ -f "$LICENSE_PATH" ] || die "license file not found: $LICENSE_PATH"
LICENSE_TOKEN="$(tr -d '[:space:]' < "$LICENSE_PATH")"
[ -n "$LICENSE_TOKEN" ] || die "license file is empty: $LICENSE_PATH"

run_verify() { dc run --rm --no-deps worker apps/worker/node_modules/.bin/tsx scripts/license-issue.ts --verify "$LICENSE_TOKEN" --edition "$1" 2>&1; }
# $1=field name, reads stdin. Handles both quoted-string and bare-number JSON
# values ("kind": "valid" as well as "daysOverdue": 31) by grabbing up to the
# next , or } and stripping the key + any quotes.
license_field() {
  # || true: under pipefail, grep finding nothing (e.g. asking for a field
  # this status kind doesn't carry, like "reason" on a valid status) would
  # otherwise silently abort the whole script via set -e.
  grep -o "\"$1\":[^,}]*" | head -1 | sed -E "s/^\"$1\":[[:space:]]*//; s/^\"//; s/\"\$//" || true
}
license_kind()   { license_field kind; }
license_reason() { license_field reason; }

primary_output="$(run_verify "$VIDYA_EDITION")"
primary_kind="$(printf '%s' "$primary_output" | license_kind)"

case "$primary_kind" in
  valid|grace)
    customer="$(printf '%s' "$primary_output" | license_field customer)"
    ok "license valid for '$customer' (edition=$VIDYA_EDITION)"
    ;;
  expired)
    customer="$(printf '%s' "$primary_output" | license_field customer)"
    overdue="$(printf '%s' "$primary_output" | license_field daysOverdue)"
    warn "license for '$customer' expired ${overdue} day(s) ago. This is NOT blocking install — expiry never blocks product use (see docs/superpowers/specs/2026-08-13-license-verification-design.md, Decision 1). It DOES mean scripts/update.sh will refuse a vendor-performed update until renewed. Continuing."
    ;;
  absent)
    die "no usable license found at $LICENSE_PATH (empty or unreadable). Obtain a license file from your vendor and re-run."
    ;;
  invalid)
    reason="$(printf '%s' "$primary_output" | license_reason)"
    if [ "$reason" = "edition-mismatch" ]; then
      other="school"; [ "$VIDYA_EDITION" = "school" ] && other="college"
      other_output="$(run_verify "$other")"
      other_kind="$(printf '%s' "$other_output" | license_kind)"
      die "license/edition mismatch: this install is configured for edition '$VIDYA_EDITION', but the license at $LICENSE_PATH is issued for edition '$other' (status as '$other': $other_kind). Re-run with the correct edition, or obtain a '$VIDYA_EDITION' license from your vendor."
    else
      die "license is invalid (reason: $reason) at $LICENSE_PATH. Obtain a fresh license file from your vendor."
    fi
    ;;
  *)
    die "could not parse license verifier output — treating as a hard failure rather than guessing. Raw output:
$primary_output"
    ;;
esac
env_set_once VIDYA_LICENSE_PATH "$LICENSE_PATH"
# VIDYA_LICENSE_PATH above is a HOST path, read only by this script and
# update.sh — the app never sees it. The containers read the token itself
# from VIDYA_LICENSE, which docker-compose.yml already passes into web and
# worker. Without the line below, a correctly-licensed install boots with
# licence status "absent" forever: no customer name, no expiry warning, no
# seat count on the admin System page.
env_set_if_blank VIDYA_LICENSE "$LICENSE_TOKEN"

# ==============================================================================
step "5/8  Deploy stack"
# ==============================================================================
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export GIT_SHA
info "starting infrastructure + migration (images already obtained in step 4/8, nothing is built here)..."
dc up -d postgres redis minio migrate
ok "infrastructure up"

info "checking migration result..."
migrate_exit="$(dc ps -a --format '{{.Name}} {{.ExitCode}}' | awk '/migrate/ {print $2; exit}' || true)"
if [ "$migrate_exit" != "0" ]; then
  die "migrations failed (exit ${migrate_exit:-unknown}). Inspect: docker compose ${COMPOSE_BASE[*]} logs migrate"
fi
ok "migrations applied"

info "starting web/worker/caddy..."
dc up -d web worker caddy
ok "app containers started"

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
  die "app did not become healthy within 60s. Inspect: docker compose ${COMPOSE_BASE[*]} logs web
Known cause: the web/worker/migrate images can fail with \"Cannot find package 'prom-client'\" — see docs/install-guide.md troubleshooting #1."
fi
ok "app is healthy"

# ==============================================================================
step "6/8  First admin account"
# ==============================================================================
# force-change-on-first-login does NOT exist in this codebase
# (packages/modules/identity/src/service/auth-service.ts:246 — a login-flow
# change was deliberately deferred). So: the technician sets the password now,
# it is shown on THIS screen only, and the handover checklist below states
# plainly that the admin must change it manually at first login.
read -r -p "Admin username [root-admin]: " ADMIN_USERNAME
ADMIN_USERNAME="${ADMIN_USERNAME:-root-admin}"
read -r -p "Admin display name [Root Admin]: " ADMIN_DISPLAY_NAME
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Root Admin}"
read -r -p "Institution name: " COLLEGE_NAME
while [ -z "$COLLEGE_NAME" ]; do read -r -p "Institution name (required): " COLLEGE_NAME; done
read -r -p "Institution short code (e.g. MAIN): " COLLEGE_CODE
while [ -z "$COLLEGE_CODE" ]; do read -r -p "Institution short code (required): " COLLEGE_CODE; done

admin_password=""
while [ "${#admin_password}" -lt 12 ]; do
  read -r -s -p "Set the admin password (min 12 chars, never shown again after this step): " admin_password
  echo
done

# Run inside the `worker` service, not `migrate`: migrate's environment block
# only carries DATABASE_URL, but create-admin.ts composes the full app (Redis,
# object storage too) and needs the full *app-env anchor, which only web and
# worker get in docker-compose.yml.
set +e
admin_output="$(
  dc run --rm --no-deps \
    -e "VIDYA_ADMIN_PASSWORD=$admin_password" \
    worker apps/worker/node_modules/.bin/tsx scripts/create-admin.ts \
    --username "$ADMIN_USERNAME" --display-name "$ADMIN_DISPLAY_NAME" \
    --college-name "$COLLEGE_NAME" --college-code "$COLLEGE_CODE" 2>&1
)"
admin_exit=$?
set -e
admin_password=""
unset admin_password

if [ $admin_exit -eq 0 ]; then
  ok "admin created: $ADMIN_USERNAME"
elif printf '%s' "$admin_output" | grep -q "an admin account already exists"; then
  ok "an admin account already exists — skipping (idempotent re-run)"
else
  fail "admin bootstrap failed:"
  printf '%s\n' "$admin_output" >&2
  die "the app is up but has no admin. Fix the error above and re-run install.sh (it will skip everything already done)."
fi

# ==============================================================================
step "7/8  Backup cron"
# ==============================================================================
CRON_LINE="30 2 * * * cd $ROOT && /usr/bin/env bash scripts/backup.sh >> $ROOT/vidya-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "$ROOT/scripts/backup.sh" || crontab -l 2>/dev/null | grep -qF "cd $ROOT && /usr/bin/env bash scripts/backup.sh"; then
  info "backup cron already installed — skipping"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  ok "backup cron installed (nightly 02:30)"
fi

info "running a backup now to prove the path works..."
# || true on each: under pipefail, ls finding no *.dump yet (e.g. very first
# run, directory not created till backup.sh runs) would abort the script via
# set -e even though wc still correctly reports 0.
before_count=$(ls -1 "$ROOT/backups/db/daily"/*.dump 2>/dev/null | wc -l || true)
bash "$ROOT/scripts/backup.sh"
after_count=$(ls -1 "$ROOT/backups/db/daily"/*.dump 2>/dev/null | wc -l || true)
[ "$after_count" -gt "$before_count" ] || die "backup.sh ran but no new dump file appeared in backups/db/daily/"
latest_backup="$(ls -1t "$ROOT/backups/db/daily"/*.dump | head -1)"
ok "backup verified: $latest_backup"

# ==============================================================================
step "8/8  Summary"
# ==============================================================================
app_version="$(grep -m1 '"version"' "$ROOT/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)"
cat <<SUMMARY

Vidya is installed.

  URL:                 https://$SITE_ADDRESS
  Version:              $app_version ($GIT_SHA)
  Edition:               $VIDYA_EDITION
  Licensed institution:  ${customer:-$(env_get VIDYA_LICENSE_PATH)}
  Admin username:        $ADMIN_USERNAME
  Backup location:       $ROOT/backups/db/daily/
  Backup cron:            30 2 * * * (nightly)

NEXT STEPS
  1. The admin password was shown on screen above and nowhere else. It is
     NOT force-changed at first login — this codebase does not have that
     feature (see docs/install-guide.md). Change it manually right after
     signing in.
  2. If this is an internet-facing install, confirm DNS for $SITE_ADDRESS
     points at this host so Let's Encrypt can issue a certificate.
  3. Run a restore drill before going live: bash scripts/restore-drill.sh
     (docs/runbook-backup-restore.md).

Full checklist: docs/install-guide.md
SUMMARY
