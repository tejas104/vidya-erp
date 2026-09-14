# Deployment checklist — Vidya (on-premise / single institution)

Companion to [`docs/runbook.md`](runbook.md) (ops) and
[`docs/runbook-backup-restore.md`](runbook-backup-restore.md). This file is the
**pre-handover** gate: every environment variable, what to set it to in
production, how to generate the secrets, and a sign-off list.

Deploy command (prod overlay on top of the base stack):

```bash
GIT_SHA=$(git rev-parse --short HEAD) \
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Put the values below in a `.env` file next to the compose files (mode `600`,
never committed — `.env` is gitignored).

## Environment variables

Legend: **🔒 secret** = generate, store in a secret manager, never commit.

### Secrets — must change from defaults

| Variable | Prod guidance | Generate |
|---|---|---|
| `POSTGRES_PASSWORD` 🔒 | Strong random; feeds `DATABASE_URL`. | `openssl rand -base64 32` |
| `MINIO_ROOT_USER` | Non-default name, e.g. `vidya-prod`. | — |
| `MINIO_ROOT_PASSWORD` 🔒 | Strong random. | `openssl rand -base64 32` |
| `VIDYA_ADMIN_PASSWORD` 🔒 | Used **once** at bootstrap (`scripts/create-admin.ts`), then rotate via the app. | `openssl rand -base64 24` |

`DATABASE_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` are derived from the
above in the compose files; if you run outside compose, set them directly and
treat the URL/keys as 🔒.

### TLS / reverse proxy (prod overlay + Caddyfile)

| Variable | Prod value | Notes |
|---|---|---|
| `SITE_ADDRESS` | `erp.yourcollege.edu` (public) or `erp.college.local` (intranet) | The domain Caddy serves. |
| `ACME_EMAIL` | Ops mailbox | Let's Encrypt account + expiry warnings. Automatic mode only. |
| `TLS_DIRECTIVE` | See below | Selects the cert mode. |

`TLS_DIRECTIVE` picks one of three modes (no Caddyfile edits):

- **Automatic HTTPS** (public, internet-reachable for ACME): `TLS_DIRECTIVE=` (empty). Needs 80/443 reachable from the internet and a real `ACME_EMAIL`.
- **Manual cert** (air-gapped/intranet): `TLS_DIRECTIVE=tls /certs/fullchain.pem /certs/privkey.pem`; drop the PEMs in `./certs/`.
- **Self-signed** (test/eval, browser warns): `TLS_DIRECTIVE=tls internal` (default).

`SESSION_COOKIE_SECURE=true` and `TRUSTED_ORIGINS` are forced by the prod
overlay — verify below.

### App config

| Variable | Prod value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Also disables the demo seeder. |
| `LOG_LEVEL` | `info` | `debug` only for incident triage. |
| `TRUSTED_ORIGINS` | `https://erp.yourcollege.edu` | CSRF layer 2 — must equal the browser origin(s), comma-separated, scheme included. Wrong value ⇒ blocked state-changing requests. |
| `SESSION_COOKIE_SECURE` | `true` | Cookie only sent over HTTPS. Overlay sets it; never `false` in prod. |
| `SESSION_COOKIE_NAME` | `vidya_session` | Change only to run two instances on one domain. |
| `SESSION_TTL_HOURS` / `SESSION_IDLE_MINUTES` | `12` / `30` | Absolute + idle session lifetime. |
| `RESET_TOKEN_TTL_MINUTES` | `30` | Password-reset token validity. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | `5` / `15` | Login throttle. Needs the proxy's `X-Forwarded-For` (Caddy sets it). |
| `BODY_MAX_BYTES` | `1048576` | Request body cap (imports are ≤1 MB). |
| `DATABASE_POOL_MAX` | `10` per replica | Keep `replicas × pool ≤` Postgres `max_connections`. |
| `REDIS_URL` | `redis://:<pass>@redis:6379` | Built by compose from `REDIS_PASSWORD` (AUTH is on — Redis holds sessions). |
| `S3_BUCKET` | `vidya` | Create it before first run if the store doesn't auto-create. |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO | `false` for AWS S3. |
| `ANALYTICS_MIN_COHORT` | `5` | Small-N suppression floor; don't lower without a privacy review. |
| `ANALYTICS_ATTENDANCE_THRESHOLD` / `ANALYTICS_MARKS_THRESHOLD` | `75` / `40` | Flag thresholds; take effect next rebuild. |
| `WORKER_METRICS_PORT` | `9464` | Scrape on the private network only. |
| `SYSTEM_HEARTBEAT_INTERVAL_MS` | `300000` | Canary cadence (5 min). |
| `SHUTDOWN_DRAIN_MS` / `SHUTDOWN_TIMEOUT_MS` | `5000` / `15000` | Graceful shutdown; set orchestrator grace > drain+timeout. |
| `VIDYA_ALLOW_DEMO_SEED` | **unset / `false`** | Must never be `true` in prod (also hard-blocked by `NODE_ENV=production`). |
| `GIT_SHA` | `$(git rev-parse --short HEAD)` at build | Stamped into the image → admin **System** page. |

## Pre-handover checklist

Bootstrap:

- [ ] `.env` created (mode 600), all 🔒 secrets generated, none left at defaults.
- [ ] First admin created: `VIDYA_ADMIN_PASSWORD=… pnpm exec tsx scripts/create-admin.ts --username … --display-name "…" --college-name "…" --college-code …`
- [ ] **Default/bootstrap admin password changed** after first sign-in.
- [ ] `VIDYA_ALLOW_DEMO_SEED` is unset; demo college absent (`SELECT 1 FROM ppl_colleges WHERE code='DEMO'` returns nothing).

TLS:

- [ ] `SITE_ADDRESS`, `ACME_EMAIL`, `TLS_DIRECTIVE` set for the chosen mode.
- [ ] HTTPS serves: `curl -k https://$SITE_ADDRESS/health` → `200`.
- [ ] HTTP redirects: `curl -sI http://$SITE_ADDRESS/` → `308` to `https://`.
- [ ] `SESSION_COOKIE_SECURE=true` (login response `Set-Cookie` has `Secure`).
- [ ] `TRUSTED_ORIGINS` equals the real browser origin; a real login works end-to-end.

Data safety:

- [ ] `scripts/backup.sh` runs clean; a dump lands in `backups/db/daily/`.
- [ ] Backup cron (or sidecar) installed; **it has run at least once** (`ls -lt backups/db/daily`).
- [ ] **Restore drill passes** on a staging copy: `bash scripts/restore-drill.sh` → `PASS`.
- [ ] Redis has AUTH; Postgres/MinIO/Redis ports are **not** published to the host (prod overlay `!reset`s them).
- [ ] For the first Redis-AUTH upgrade, a sign-in interruption was announced; recreating Redis invalidates existing sessions.

Ops:

- [ ] `pnpm db:status` clean after deploy.
- [ ] Admin **System** page shows the expected version + git SHA (record it in the license register).
- [ ] `/metrics` reachable only from the scrape network, not the public origin.
