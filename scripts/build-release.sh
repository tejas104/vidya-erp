#!/usr/bin/env bash
# Vidya release builder: packages releases/vidya-<version>.tar.gz from the
# current git tree.
#
#   bash scripts/build-release.sh [--offline] [--force]
#
# Produces the layout update.sh already expects (update.sh step 2/7:
# unwraps a single top-level wrapping directory if the tarball has one,
# requires package.json + docker-compose.yml at that root, then rsyncs
# everything else onto the existing install untouched except .env/backups/
# certs/.git). This script does not modify install.sh/update.sh at all —
# read them before changing this file's output shape.
#
# Two modes, one flag:
#   (default)  registry mode — builds + validates the migrate/web/worker
#              images locally (so a broken build is caught HERE, not on a
#              client server) and tags them vidya-{web,worker,migrate}:
#              <version> for a registry push, but does not bundle image
#              tarballs. The shipped tarball is source-only; install.sh/
#              update.sh build the images ON the client via `docker compose
#              up -d --build`, exactly as they already do today. Pushing
#              the tagged images to a registry is a separate, deliberate
#              step this script does not perform for you (`docker push
#              <registry>/vidya-web:<version>` etc., after tagging).
#   --offline  additionally `docker save`s the built images, plus the
#              third-party base images the compose files pull directly
#              (postgres, redis, minio, caddy — no build step, so these
#              alone are fully solved by this), into the tarball's
#              images/ directory, with a load helper and a README.
#              HONEST LIMITATION (read images/README.md in the output, and
#              this script's own step 5 banner): install.sh/update.sh
#              always run `docker compose up -d --build` for migrate/web/
#              worker, which re-executes each Dockerfile's `pnpm install
#              --frozen-lockfile` step on the client, needing npm registry
#              access regardless of what's pre-loaded via `docker load`.
#              This bundle removes the network dependency for the four
#              third-party images and for pulling node:22-alpine, but does
#              NOT make a fully air-gapped `docker compose up --build`
#              possible end-to-end — that needs either a vendored pnpm
#              store or a change to install.sh/update.sh to prefer
#              pre-loaded images over rebuilding, neither of which is in
#              this script's scope (install.sh/update.sh are #12 parts
#              2-4, already shipped).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- output helpers -----------------------------------------------------
# Deliberately NOT sourced from install.sh/update.sh — same reasoning update
# .sh gives for its own copy: these run at different times, a shared file is
# one more thing that has to ship correctly.
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

pkg_version() { grep -m1 '"version"' "$1/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/'; }

# --- args -----------------------------------------------------------------
MODE="registry"
FORCE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --offline) MODE="offline"; shift ;;
    --force) FORCE=true; shift ;;
    --version|--version=*)
      die "there is no --version flag — the version comes from this repo's package.json only, so it can never disagree with what's actually built. Bump package.json and re-run." ;;
    -h|--help)
      sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument: $1 (--help for usage)" ;;
  esac
done

COMPOSE_BASE=(-f docker-compose.yml -f docker-compose.prod.yml)
dc() { docker compose "${COMPOSE_BASE[@]}" "$@"; }

# ==============================================================================
step "1/6  Preflight"
# ==============================================================================
command -v docker >/dev/null 2>&1 || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) not found."
command -v git >/dev/null 2>&1 || die "git not found."
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $ROOT"
[ -f docker-compose.yml ] && [ -f docker-compose.prod.yml ] && [ -f Caddyfile ] || \
  die "docker-compose.yml / docker-compose.prod.yml / Caddyfile not found at repo root — run this from the repo, not a subdirectory."
ok "preflight ok"

# ==============================================================================
step "2/6  Version & provenance"
# ==============================================================================
VERSION="$(pkg_version "$ROOT")"
[ -n "$VERSION" ] || die "could not read a version out of package.json."

# "Dirty" means TRACKED files have uncommitted changes (modified/staged/
# deleted) — checked with --untracked-files=no on purpose. Untracked files
# (this repo currently has several: backups/, certs/, .claude/, stray logs —
# none of them gitignored, all of them irrelevant to a release) never end up
# in the tarball either way, since step 4 packages via `git archive`/`git
# stash create`, which only ever look at tracked content. Flagging the
# working tree dirty because of an untracked scratch file would be a false
# alarm that trains everyone to reach for --force out of habit, defeating
# the point of the gate — the real risk this guards against is a tracked
# file with real, uncommitted edits silently missing from (or differing
# from) the shipped tarball.
DIRTY=false
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  DIRTY=true
fi

if [ "$DIRTY" = true ] && [ "$FORCE" != true ]; then
  fail "working tree has uncommitted changes to tracked files — a release whose SHA doesn't describe its contents is worse than no release:"
  git status --porcelain --untracked-files=no | sed 's/^/         /' >&2
  die "commit or stash first, or pass --force to build from the working tree as-is (git stash create — untracked NEW files still won't be included; git add them first if they must ship)."
fi
if [ "$DIRTY" = true ]; then
  warn "--force: building from a dirty working tree. The embedded SHA below describes the last COMMIT, not these uncommitted edits."
fi

GIT_SHA="$(git rev-parse --short HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo "    Version:  $VERSION"
echo "    Git SHA:  $GIT_SHA$( [ "$DIRTY" = true ] && echo ' (+ uncommitted changes)' )"
echo "    Mode:     $MODE"
echo "    Built:    $BUILT_AT"
echo
ok "version/provenance resolved"

# ==============================================================================
step "3/6  Build images"
# ==============================================================================
# GIT_SHA flows into the web image's build arg (docker-compose.prod.yml),
# which apps/web/next.config.ts reads and surfaces on the admin System page
# — the mechanism that already exists; this script doesn't invent a second
# one. migrate and worker share apps/worker/Dockerfile.
export GIT_SHA
info "docker compose build migrate web worker (this can take a few minutes)..."
if ! dc build migrate web worker; then
  die "image build failed — see docker's own error above.
Not producing a tarball: a release that ships broken images is worse than
no release. If the error is \"Cannot find package '<something>'\" at
runtime (not at build time), that is the known pnpm-workspace COPY gap —
apps/web/Dockerfile and apps/worker/Dockerfile must COPY every
packages/modules/*/package.json (and packages/ui-system/package.json)
before \`pnpm install --frozen-lockfile\` runs, not just the ones the app
imports directly, because pnpm resolves the WHOLE workspace lockfile in one
pass. See docs/install-guide.md troubleshooting #1."
fi
ok "images built"

# Same naming convention update.sh uses for its rollback tags (verified
# against this repo: \`docker compose config --images web\` resolves through
# the whole dependency subgraph, so it isn't used for a per-service lookup
# here either — same reasoning as update.sh's comment).
PROJECT="$(echo "${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}" | tr '[:upper:]' '[:lower:]')"
WEB_IMAGE="${PROJECT}-web:latest"
WORKER_IMAGE="${PROJECT}-worker:latest"
MIGRATE_IMAGE="${PROJECT}-migrate:latest"

IMAGE_SRCS=("$WEB_IMAGE" "$WORKER_IMAGE" "$MIGRATE_IMAGE")
IMAGE_NAMES=("vidya-web" "vidya-worker" "vidya-migrate")
for i in "${!IMAGE_SRCS[@]}"; do
  src="${IMAGE_SRCS[$i]}"; name="${IMAGE_NAMES[$i]}"
  docker tag "$src" "${name}:${VERSION}"
  ok "tagged ${name}:${VERSION} (from $src) — ready for \`docker tag ${name}:${VERSION} <registry>/${name}:${VERSION} && docker push ...\` if you're pushing to a registry"
done

# ==============================================================================
step "4/6  Stage release tree"
# ==============================================================================
STAGE_PARENT="$(mktemp -d)"
cleanup() { rm -rf "$STAGE_PARENT"; }
trap cleanup EXIT
PKG_NAME="vidya-$VERSION"
STAGE_DIR="$STAGE_PARENT/$PKG_NAME"

# git archive (or, if --force'd past a dirty tree, `git stash create`'s
# tree-ish, which is the working tree's tracked content without touching
# the actual stash ref) — TRACKED FILES ONLY, always. This is what keeps
# .env, backups/, certs/, .claude/, *.log etc. out of the tarball without
# needing a hand-maintained exclude list: they were never tracked, so they
# never exist in what `git archive` reads from, full stop.
if [ "$DIRTY" = true ]; then
  ARCHIVE_REF="$(git stash create)"
  [ -n "$ARCHIVE_REF" ] || ARCHIVE_REF="$(git rev-parse HEAD)"
else
  ARCHIVE_REF="$(git rev-parse HEAD)"
fi
mkdir -p "$STAGE_DIR"
git archive --format=tar "$ARCHIVE_REF" | tar -x -C "$STAGE_DIR"
ok "archived tracked tree ($ARCHIVE_REF) into staging"

[ -f "$STAGE_DIR/package.json" ] && [ -f "$STAGE_DIR/docker-compose.yml" ] || \
  die "internal error: staged tree is missing package.json/docker-compose.yml — refusing to package."

# Never ship a real .env — belt-and-suspenders on top of git archive only
# ever seeing tracked content (.env is gitignored and has never been
# committed in this repo, but assert it anyway rather than trust that).
[ -e "$STAGE_DIR/.env" ] && die "internal error: a .env landed in the staged tree — aborting, not packaging a tarball that could contain secrets."

cat > "$STAGE_DIR/RELEASE_INFO.txt" <<INFO
Vidya release
  version:    $VERSION
  git sha:    $GIT_SHA$( [ "$DIRTY" = true ] && echo ' (+ uncommitted changes at build time)' )
  mode:       $MODE
  built (UTC): $BUILT_AT
INFO

mkdir -p "$STAGE_DIR"
cat > "$STAGE_DIR/LICENSE-SETUP.md" <<'LICDOC'
# License file — required before install.sh will proceed

This release does not (and never will) include a license. Bring your own
`license.json`, obtained from your Vidya vendor for this specific
institution and edition (`college` or `school`).

## Where it goes

Place it in this same directory, next to `docker-compose.yml` and
`install.sh` — the default path `install.sh` asks for (step 4/8) is
`./license.json` relative to wherever you unpacked/ran the installer from.
You can point it elsewhere by answering that prompt with a different path;
the value you give is remembered in `.env` as `VIDYA_LICENSE_PATH` so
`update.sh` can re-check it on every future update.

## What happens without one

`install.sh` step 4/8 reads and verifies this file before it will bring up
any containers. No file (or an empty/unreadable one) aborts installation
outright — there is no way to install without a license, valid or expired.

An **expired** license is different: it does not block installation or stop
the app from running (see
`docs/superpowers/specs/2026-08-13-license-verification-design.md`,
Decision 1) — every feature keeps working, indefinitely. What it DOES block
is `update.sh`'s vendor-performed update step, since that is an AMC
(Annual Maintenance Contract) service.

## How to obtain one

Contact your vendor with:
  - the institution name,
  - the edition you're installing (`college` or `school` — must match what
    you choose at `install.sh` step 2/8, or step 4/8 refuses with an
    edition-mismatch error),
  - and, if renewing, your existing license's `id` (`scripts/license-issue.ts
    --verify` prints it, if you have an old copy to inspect).
LICDOC
ok "staged LICENSE-SETUP.md and RELEASE_INFO.txt"

# ==============================================================================
step "5/6  Offline images"
# ==============================================================================
if [ "$MODE" != "offline" ]; then
  info "registry mode — skipping (no image tarballs bundled; install.sh/update.sh build images on the client via \`docker compose up -d --build\`, same as they do without this bundle at all)."
else
  IMAGES_DIR="$STAGE_DIR/images"
  mkdir -p "$IMAGES_DIR"

  # Third-party images the compose files pull directly (no build: key) —
  # these are the ones offline mode genuinely, fully solves: no build step,
  # no npm registry, just a plain `docker load` replacing a `docker pull`.
  THIRD_PARTY=(postgres:17-alpine redis:7-alpine minio/minio:latest caddy:2-alpine)
  for img in "${THIRD_PARTY[@]}"; do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      info "pulling $img..."
      docker pull "$img"
    fi
  done

  ALL_IMAGES=("${THIRD_PARTY[@]}" "vidya-web:${VERSION}" "vidya-worker:${VERSION}" "vidya-migrate:${VERSION}")
  for img in "${ALL_IMAGES[@]}"; do
    out="$IMAGES_DIR/$(echo "$img" | tr '/:' '__').tar.gz"
    info "docker save $img ..."
    docker save "$img" | gzip -1 > "$out"
    ok "  -> $(basename "$out") ($(du -h "$out" | cut -f1))"
  done

  cat > "$IMAGES_DIR/README.md" <<'IMGDOC'
# Pre-built images (offline install)

Load all of these into the target host's local Docker BEFORE running
`install.sh`:

    for f in images/*.tar.gz; do gunzip -c "$f" | docker load; done

## What this does and does not solve

- `postgres`, `redis`, `minio`, `caddy` — fully solved. These compose
  services have no build step; `docker load`ing them here means the
  `docker compose up` calls in `install.sh`/`update.sh` never need to pull
  them, full stop.
- `vidya-web`, `vidya-worker`, `vidya-migrate` — partially solved, and you
  need to know the gap. `install.sh` and `update.sh` always run
  `docker compose up -d --build` for these three services (see their own
  "5/8 Deploy stack" / "6/7 Apply, migrate, restart" steps) — `--build`
  unconditionally re-runs each Dockerfile, including `pnpm install
  --frozen-lockfile`, which needs npm registry access. Loading the images
  in this folder pre-warms the `node:22-alpine` base layer (so that part of
  the build doesn't need network) but does NOT make the `pnpm install` step
  skip the network. A host with truly zero internet access — not even an
  internal npm/pnpm mirror — cannot complete `install.sh`/`update.sh` from
  this bundle alone.

  This is a real, currently-open gap between what "offline mode" promises
  and what the incumbent `install.sh`/`update.sh` (already shipped,
  unmodified by this release-builder) actually do: they were written to
  always build from source, not to prefer a pre-loaded image. Closing it
  needs either vendoring the pnpm store into the release tree, or changing
  install.sh/update.sh to skip `--build` when a matching image is already
  loaded — both are deliberately out of scope for `scripts/build-release.sh`
  itself. If your target host truly has no network path to npm at all,
  point it at an internal pnpm/npm mirror (`npm config set registry ...`
  inside the build context) rather than relying on this folder alone.
IMGDOC
  ok "offline images staged ($(ls "$IMAGES_DIR"/*.tar.gz | wc -l) tarballs)"
fi

# ==============================================================================
step "6/6  Package tarball"
# ==============================================================================
mkdir -p "$ROOT/releases"
OUT="$ROOT/releases/vidya-$VERSION.tar.gz"
[ -e "$OUT" ] && warn "overwriting existing $OUT"
tar -czf "$OUT" -C "$STAGE_PARENT" "$PKG_NAME"
SIZE="$(du -h "$OUT" | cut -f1)"
SHA256="$( (command -v sha256sum >/dev/null 2>&1 && sha256sum "$OUT" || shasum -a 256 "$OUT") | cut -d' ' -f1)"

echo
echo "  releases/vidya-$VERSION.tar.gz"
echo "    size:    $SIZE"
echo "    sha256:  $SHA256"
echo "    version: $VERSION"
echo "    git sha: $GIT_SHA"
echo "    mode:    $MODE"
echo
ok "release built"
