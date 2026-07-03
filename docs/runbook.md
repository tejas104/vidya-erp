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

## Routine checks

- `GET /ready` on every replica after deploys.
- `pnpm db:status` against production after each release.
- Audit sanity: recent rows via the system service (psql:
  `SELECT occurred_at, action, module FROM sys_audit_log ORDER BY id DESC LIMIT 20;`
  — reads are fine; writes outside the app will hit the triggers).
