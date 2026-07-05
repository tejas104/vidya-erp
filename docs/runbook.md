# Ops runbook — Vidya foundation

## Processes

| Process | Image | Port | Probes |
|---|---|---|---|
| web | `apps/web/Dockerfile` (standalone Next) | 3000 | `/health` (liveness), `/ready` (readiness), `/metrics` |
| worker | `apps/worker/Dockerfile` (tsx) | 9464 | same three paths on 9464 |
| migrate | worker image, one-shot | — | exits 0 on success |

Environment: see `.env.example` — every variable, with defaults where safe.
Required with no default: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`. A replica that
fails config validation logs the offending **variable names** (never
values) and exits non-zero.

## Deploy order

1. Run migrations as a one-shot job (`scripts/migrate.ts up` — compose does
   this via the `migrate` service; any orchestrator should model it as an
   init/pre-deploy job). The advisory lock makes accidental concurrent
   runs safe.
2. Roll web and worker replicas in any order — both are stateless.

## <a id="graceful-shutdown"></a>Graceful shutdown semantics

**Web** (requires `NEXT_MANUAL_SIG_HANDLE=true`, set in the image):
SIGTERM → `Lifecycle.isDraining` flips immediately → `/ready` returns 503
`{"status":"draining"}` → load balancer stops routing (keep LB
readiness-driven!) → after `SHUTDOWN_DRAIN_MS` (default 5000) close hooks
run LIFO (object storage, redis, pg pool) → exit 0. Hard ceiling
`SHUTDOWN_TIMEOUT_MS` (default 15000) → exit 1 if exceeded. Set the
orchestrator's terminationGracePeriod > drain + timeout.

**Worker:** SIGTERM → BullMQ `worker.close()` waits for in-flight jobs →
queue/observability/pg/redis close → exit. No drain delay (no LB).

## Migrations

- `pnpm db:migrate` / `pnpm db:rollback` (last one) /
  `pnpm db:rollback -- --steps N` / `pnpm db:status`.
- Every migration has a paired `.down.sql` — the runner refuses to start
  otherwise.
- **Before any production rollback, take a backup.** Rolling back
  `system/0000_audit_log` destroys the audit trail by definition.
- Journal lives in `platform_migrations`; drift (journal entry missing on
  disk, or out-of-order application) aborts with an explicit error —
  resolve by restoring the missing files, never by editing the journal.

## Observability

- **Logs:** JSON lines on stdout (pino). Correlate with `requestId`; every
  response carries `x-request-id`. Access logs: `"request completed"` with
  route id, status, durationMs, actorId.
- **Metrics:** `vidya_http_request_duration_seconds`,
  `vidya_http_requests_total`, `vidya_jobs_total`,
  `vidya_job_duration_seconds` + Node defaults, labeled
  `service=vidya-web|vidya-worker`. Scrape every replica. **Restrict
  /metrics to the scrape network** — it is public at the app layer in this
  phase by documented decision.
- **Heartbeat as canary:** the worker upserts `system.audit-heartbeat`
  every `SYSTEM_HEARTBEAT_INTERVAL_MS` (default 5 min). Alert if
  `max(vidya_jobs_total{job="audit-heartbeat",outcome="success"})` stops
  increasing — it means Redis, the worker, or Postgres is broken.

## Identity operations (#2)

- **Bootstrap (once per installation):**
  `VIDYA_ADMIN_PASSWORD=<strong> pnpm exec tsx scripts/create-admin.ts --username <u> --display-name "<n>" --college-id <opaque-id>` —
  refuses if any admin exists. Requires DATABASE_URL, REDIS_URL and the
  human-owned core (fails closed without it).
- **Fail-closed boot:** until the security core lands (ADR-0012), every
  replica answers 500 on all routes including /health, with
  `identity security core not provided` in the logs. That is intended,
  not an outage to work around.
- **Password reset:** admin calls `POST /api/v1/identity/users/{id}/password-reset`,
  reads the one-time token from the response (it is shown exactly once,
  never logged), and hands it to the user out-of-band (in person / phone —
  institutional procedure). The user redeems at
  `POST /api/v1/identity/auth/password-reset/confirm` within 30 minutes.
- **Locked-out user:** the window self-expires (default 15 min). Bursts of
  `identity.login-failed` audit rows with `locked:true` against one
  username from many IPs = investigate as an attack, not a forgotten
  password.
- **Kill a user's access NOW:** `PATCH /users/{id}` with
  `{"status":"disabled"}` — disables the account AND invalidates every
  session immediately. Role/grant changes also invalidate sessions.
- **Deployment prerequisites:** TLS termination at the institution proxy
  (session cookie is Secure in production), proxy must set
  `x-forwarded-for` (throttle keying), Redis with AUTH on the private
  network (it now holds sessions), `TRUSTED_ORIGINS` set to the browser
  origin(s) once a UI exists.

## People module operations (#3)

- **Bootstrap now creates the college too:**
  `VIDYA_ADMIN_PASSWORD=<strong> pnpm exec tsx scripts/create-admin.ts --username <u> --display-name "<n>" --college-name "<name>" --college-code <CODE>`
  — idempotent on the college (by code), refuses a second admin.
- **Grant-verification backfill (run once after deploying #3):** build the
  org tree via the API, then `POST /api/v1/identity/grants/verify` (admin).
  Resolvable pre-#3 grants flip to verified; the response lists unresolved
  ones with reasons — fix those grants (or the tree) by hand; the sweep
  never deletes authority.
- **Bulk imports:** `POST /api/v1/people/imports` with the CSV in the JSON
  body (≤1 MB; export CSV from Excel), `dryRun:true` first, then poll
  `GET /imports/{id}` for counts and per-row errors (capped at 500). Rows
  created by an import carry its id in `source_import_id`. Failed imports
  can simply be re-run: existing rows surface as per-row "already exists"
  errors, not duplicates. Consider a MinIO lifecycle rule expiring
  `imports/*` objects after ~30 days.
- **Grant reconciliation:** hourly on the worker
  (`people.grant-reconcile-repaired` audit rows = repairs happened —
  investigate what caused drift). On-demand: enqueue the job or restart the
  worker (schedule upsert is idempotent).
- **Academic-year rollover:** remove/recreate teacher assignments for the
  new year (grants follow automatically); enroll students into the new
  year's sections (the one-live-enrollment rule is per year, so old years
  stay intact for history).

## Routine checks

- `GET /ready` on every replica after deploys.
- `pnpm db:status` against production after each release.
- Audit sanity: recent rows via the system service (psql:
  `SELECT occurred_at, action, module FROM sys_audit_log ORDER BY id DESC LIMIT 20;`
  — reads are fine; writes outside the app will hit the triggers).
