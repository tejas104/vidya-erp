# Install guide — Vidya (on-premise, single institution)

Run `install.sh` from the root of a Vidya release checkout/bundle on the
target Ubuntu host. It is interactive and **safe to re-run** — every step
detects what it already did and skips it (see "Idempotence" at the end of
each step below).

This guide covers **installation only**. For env var reference and the
sign-off checklist that pairs with it, see
[`docs/deployment-checklist.md`](deployment-checklist.md). For backups,
[`docs/runbook-backup-restore.md`](runbook-backup-restore.md). For upgrading
an existing install, [`docs/update-guide.md`](update-guide.md).

## Prerequisites

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | **4 cores** |
| RAM | 4 GB | **8 GB** |
| Disk | 20 GB | **100 GB** (comfortably covers up to ~2,000 students: Postgres data, MinIO objects, 7 daily + 4 weekly backup dumps) |
| OS | any recent Linux | **Ubuntu 24.04 LTS** (the tested target — `install.sh` warns, but does not refuse, on anything else) |
| Software | Docker Engine + Compose v2 plugin, Node.js 22.x on the host | `install.sh` offers to install Docker; Node.js must already be present (needed to run the license CLI and admin-bootstrap CLI on the host, before any container exists) |
| Network | Port 80 and 443 free on the host | Caddy is the only thing allowed to bind them (`docker-compose.prod.yml` unpublishes every other service) |
| A license file | from your vendor | required before step 4 will pass |

## Network options

Chosen interactively in step 2 (`install.sh` prompts for a domain, or blank
for LAN-only). This decision affects **who can reach the app and how**:

- **Internet-facing** (a real domain, e.g. `erp.yourcollege.edu`, with DNS
  pointing at this host): Caddy automatically provisions a Let's Encrypt
  certificate. Anyone with the URL — including teachers on their phones over
  mobile data, off-campus — can reach the app from anywhere. This is the mode
  to pick if teacher mobile attendance-marking from outside campus wifi
  matters.
- **LAN-only** (blank domain): `install.sh` binds to the host's LAN IP and
  Caddy serves a **self-signed** certificate (browsers show a one-time
  warning — expected, not a bug, see troubleshooting #10). Only devices on
  the same network (campus wifi, campus ethernet) can reach the app. Teacher
  phones work fine **on campus wifi**; they will not reach the app over
  mobile data or from home. Cheaper and simpler to run (no DNS, no ACME, no
  internet exposure) but narrows access to campus.

Both modes always serve HTTPS — `SESSION_COOKIE_SECURE=true` is forced by the
prod overlay regardless of mode, so there is no plain-HTTP fallback in either
case.

## Step-by-step

Run:

```bash
bash install.sh
```

### 1/8 Preflight

Checks OS, Docker + Compose (offers to install Docker via the official
convenience script if missing), ports 80/443, disk, memory, CPU, and that
`node`/`npx` are on `PATH`. Each check prints `[ OK ]`, `[WARN]` (proceeds
anyway), or `[FAIL]` (aborts with a specific fix).

**Idempotence:** every check is stateless (re-reads the host each run); there
is nothing to "skip" here, it just re-verifies.

### 2/8 Configuration

Prompts for domain (or blank for LAN-only), edition (`college`/`school`), and
an admin contact email — the same email doubles as the Let's Encrypt account
address. Writes `SITE_ADDRESS`, `VIDYA_EDITION`, `ACME_EMAIL`,
`TRUSTED_ORIGINS`, `TLS_DIRECTIVE` to `.env`.

Expected output:
```
[ OK ] domain=erp.college.edu edition=college admin-email=ops@college.edu
```

**Idempotence:** if `.env` already has `SITE_ADDRESS`, `VIDYA_EDITION` and
`ACME_EMAIL` set, the prompts are skipped entirely and the existing values
are reused. Delete `.env` to reconfigure from scratch (this also means
re-generating secrets — see step 3).

### 3/8 Secrets

Generates `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` (both `openssl rand -hex
24`) and `REDIS_PASSWORD` into `.env`, mode `600`. **Values are never printed
to the screen or logged** — only a `generated` / `already set` line per
variable.

Expected output:
```
[ .. ]   POSTGRES_PASSWORD already set in .env — leaving unchanged
[ OK ]   MINIO_ROOT_PASSWORD generated
[ OK ]   REDIS_PASSWORD generated
```

> **Known gap:** `REDIS_PASSWORD` is generated (Redis is where sessions
> live, and `docs/deployment-checklist.md` flags "Add AUTH in prod" against
> exactly this) but `docker-compose.yml`'s `redis` service does not yet apply
> `--requirepass`, so this value has no effect on a running install today.
> It is written so the value exists and doesn't need re-generating once that
> wiring lands. Not fixed here — out of this script's file scope.

**Idempotence:** each secret is generated only if its name is absent from
`.env`. An existing value is never regenerated or overwritten — re-running
`install.sh` against a working install changes nothing here.

### 4/8 License verification

Reads the license file (prompts for a path, default `./license.json`) and
shells out to `npx tsx scripts/license-issue.ts --verify <token> --edition
<edition>` — **no signature/crypto logic lives in `install.sh` itself**, it
only reads that command's JSON output.

Success:
```
[ OK ] license valid for 'Northgate Junior College' (edition=college)
```

An **expired** license (past the 30-day grace window) does **not** abort
install — it warns and continues. This matches deliberate product policy: a
license lapsing must never stop a college's information system from
working. See [Decision 1 in the license spec](superpowers/specs/2026-08-13-license-verification-design.md).

An **edition mismatch** aborts, naming both editions:
```
[FAIL] license/edition mismatch: this install is configured for edition
'college', but the license at ./license.json is issued for edition 'school'
(status as 'school': valid). Re-run with the correct edition, or obtain a
'college' license from your vendor.
```

**Idempotence:** the verified path is written to `VIDYA_LICENSE_PATH` in
`.env`; a re-run reuses it without re-prompting (verification itself always
re-runs — it's a stateless, side-effect-free check).

### 5/8 Deploy stack

Runs `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
--build` in two waves (infra + migrate, then web/worker/caddy), checks the
`migrate` container's exit code explicitly, then polls the web container's
own `/api/v1/system/ready` endpoint (via `docker compose exec`, exactly like
the image's built-in `HEALTHCHECK`) for up to 60 seconds.

Expected output:
```
[ OK ] infrastructure up
[ OK ] migrations applied
[ OK ] app containers started
[ OK ] app is healthy
```

**Idempotence:** `docker compose up -d --build` is inherently idempotent —
unchanged services are left running, changed ones are recreated. Migrations
are additive (already-applied migrations are no-ops).

### 6/8 First admin account

Prompts for username, display name, institution name/code, and the admin
password (typed twice — no, once, with input hidden; minimum 12 characters).
Runs `scripts/create-admin.ts` inside a one-off `worker`-image container on
the compose network (needs the full app environment — Postgres, Redis,
object storage — which only `web`/`worker` carry in `docker-compose.yml`).

**This codebase has no force-change-on-first-login.**
`packages/modules/identity/src/service/auth-service.ts:246` says so
plainly — building it would mean changing the login-flow choreography, which
was deliberately deferred. So: the password you type here is shown on your
terminal **at the moment you type it and nowhere else, ever again** — it is
never written to `.env`, never logged, never echoed back. **The technician
running this install has now seen the admin password.** The handover
checklist below exists because of this; the admin must change it manually
immediately after first sign-in.

Expected output:
```
[ OK ] admin created: root-admin
```

**Idempotence:** `create-admin.ts` itself refuses when any admin already
exists (`"bootstrap refused: an admin account already exists"`) —
`install.sh` recognizes that exact message and treats it as a skip, not a
failure:
```
[ OK ] an admin account already exists — skipping (idempotent re-run)
```

### 7/8 Backup cron

Installs a nightly `30 2 * * *` crontab entry running `scripts/backup.sh`,
then **runs one backup immediately** and asserts a new `.dump` file actually
landed in `backups/db/daily/`.

Expected output:
```
[ OK ] backup cron installed (nightly 02:30)
[ OK ] backup verified: /opt/vidya/backups/db/daily/vidya-20260817-...dump
```

**Idempotence:** the crontab is checked for an existing line referencing
`scripts/backup.sh` before appending — re-running never duplicates the cron
entry. The immediate backup always runs again (cheap, and proves the path
still works), which is why a re-run's `backups/db/daily/` gets one more dump
than before — that's expected, not a bug.

### 8/8 Summary

Prints the URL, version + git SHA, edition, licensed institution, admin
username, backup location/schedule, next steps, and the `docker-compose.yml`
env-passthrough gap noted above.

## Handover checklist

- [ ] Admin password **changed** by the actual admin at first login (the
      technician who ran the installer has seen it — that is expected and
      documented, not a leak, but it must be rotated).
- [ ] TLS verified: `curl -k https://<SITE_ADDRESS>/health` → `200`; for
      internet-facing installs, confirm the certificate is real (not
      self-signed) once DNS has propagated.
- [ ] Backup ran (step 7 output shows a verified dump) and the cron entry is
      present: `crontab -l | grep backup.sh`.
- [ ] **Restore drill done**: `bash scripts/restore-drill.sh` → `PASS`
      (`docs/runbook-backup-restore.md`).
- [ ] Credentials handed to the institution: admin username + URL (**never**
      the password — the admin sets/knows it from step 6, or resets it).
- [ ] License file kept somewhere durable outside this host too (the path in
      `.env`'s `VIDYA_LICENSE_PATH` is the only place `update.sh` will look
      for it next time).

## Troubleshooting

The 10 most likely failures, grounded in this repo's actual behavior — not
generic Docker advice:

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | `migrate`/`web`/`worker` containers exit immediately with `Cannot find package 'prom-client'` | Known, real bug in the current `apps/web/Dockerfile` / `apps/worker/Dockerfile` build: the pnpm-install layer only `COPY`s a subset of workspace `package.json` files before running `pnpm install --frozen-lockfile`, so some transitive deps used by `@vidya/platform` (e.g. `prom-client`) don't get linked correctly | Not fixable from `install.sh`/`update.sh` (Dockerfile changes are out of this task's scope). Rebuild with `docker compose build --no-cache migrate` after the Dockerfile fix ships; track this as a blocking infra bug if it hasn't landed yet |
| 2 | Postgres container looks healthy but the app can't connect, or connects to the wrong data | A native PostgreSQL already running on the host and bound to `5432` (or `5433`) silently absorbs connections/port mappings meant for the container — this happened on the dev machine (native PG 14/15 squatting both ports) | `sudo ss -ltnp \| grep 543` to find the offending process; stop/disable the host Postgres (`sudo systemctl stop postgresql`) before installing, or don't install Postgres natively on a Vidya host at all |
| 3 | `permission denied while trying to connect to the Docker daemon socket` | The install user isn't in the `docker` group yet (common right after the convenience-script install in step 1) or the docker service isn't running | `sudo usermod -aG docker $USER` then log out/in (or `newgrp docker`); `sudo systemctl status docker` |
| 4 | Step 5 finishes, app is healthy, but `https://<domain>/` times out or shows a certificate error from outside the host | DNS for the chosen domain isn't pointing at this host yet, so Caddy's automatic ACME challenge can't complete (internet-facing mode only) | `dig +short <domain>` from outside the network and confirm it resolves to this host's public IP; wait for propagation, then `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart caddy` |
| 5 | Step 4 fails: `license/edition mismatch` | The license file was issued for the other edition (`college` vs `school`) than what was chosen in step 2 | Re-run `install.sh` and pick the matching edition, or get a correctly-issued license from the vendor — do not edit the license file by hand, it's signed |
| 6 | Step 5 build fails partway with disk-space errors, or Postgres refuses writes | Disk filled during image build/pull (`docker system df` to check) — more likely on the 20–100 GB minimum end | `docker system prune` to reclaim build cache from failed attempts; add disk before re-running |
| 7 | Manually running `pnpm --filter @vidya/web build` (outside `install.sh`, e.g. while debugging) fails prerendering `/manage/marks` with `Cannot read properties of null (reading 'useContext')` | Sourcing `.env` before the build sets `NODE_ENV=development`, so Next emits a dev-mode React build that a page's static prerender can't handle | Never `source .env` before a manual build; `install.sh`/`update.sh` never do this — `NODE_ENV=production` is set inside the Dockerfile's runtime stage only, after the build step |
| 8 | Step 7's immediate backup passes, but `backups/db/daily/` never gets a second file the next morning | Some minimal Ubuntu images/hosts don't have `cron`/`crond` installed or running, so the crontab entry exists but never fires | `systemctl status cron` (`sudo apt install cron` if absent), `sudo systemctl enable --now cron` |
| 9 | Ports 80/443 pass the local preflight check but external ACME/HTTPS still can't reach the host | A firewall or cloud security group (ufw, a hosting provider's default rules) blocks 80/443 from the internet even though nothing local is bound to them | `sudo ufw allow 80,443/tcp` (or the equivalent cloud console rule); re-test with `curl -I http://<domain>` from an external network, not from the host itself |
| 10 | Browser shows "Your connection is not private" / a self-signed certificate warning | **Expected in LAN-only mode** — `TLS_DIRECTIVE=tls internal` mints a local CA Caddy trusts, browsers don't. Not a bug | Either accept the browser warning (fine for an intranet install) or switch to internet-facing mode with a real domain for automatic trusted certificates |
