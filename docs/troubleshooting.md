# Troubleshooting guide

## A replica exits immediately at boot

Almost always config. The first log line is a `ConfigError` listing the
offending variable **names**. Fix the environment; values are never
printed by design.

## `/ready` returns 503

- `{"status":"draining"}` — the replica received SIGTERM and is shutting
  down; expected during deploys. If no deploy is happening, something is
  signaling your process (orchestrator OOM? restart policy?).
- `{"status":"unready","checks":[…]}` — the named check (`postgres` /
  `redis`) is failing. Details are in the replica's logs
  (`"readiness check failed"`), not in the response. A check that hangs
  >2s counts as failed (timeout).

## Every route returns 500 with "identity security core not provided"

The HUMAN-OWNED security core (packages/modules/identity/src/core) has not
been implemented yet — the platform fails closed by design (ADR-0012).
Nothing to fix in config; the security team's implementation PR unblocks it.

## 401 on every API route

You have no (valid) session. Log in at
`POST /api/v1/identity/auth/login`; the `vidya_session` cookie must
accompany subsequent requests. Sessions also die on absolute/idle expiry
and on any role/grant/status/password change (by design). Public routes:
`/health`, `/ready`, `/metrics`, login, and reset-confirm only.

## 403 on a route you believe you may call

Three distinct gates produce 403 — check logs by requestId:
- `request rejected: forbidden` → route-level role requirement
  (e.g. management routes need the `admin` role);
- `scope check denied` → the record-level ScopeChecker (ADR-0010 matrix)
  — the caller's grants don't cover the record's org position;
- `request rejected: untrusted cross-origin` → state-changing request with
  a foreign Origin header; fix `TRUSTED_ORIGINS`.

## 429 too many attempts

Login or reset-token lockout (default 5 failures / 15 min per user+IP).
Self-expires; `Retry-After` is on the response. See the runbook before
manually clearing anything.

## Login says 403 "password reset required"

The account is in `must_reset` (new account or admin-issued reset). An
admin issues a one-time token; redeem it at password-reset/confirm.

## 500 with `requestId` on a state-changing route

Check logs for that requestId. If the message is an audit insert failure,
the request was failed **deliberately** (fail-closed audit, Constitution
rule 7) — restore Postgres/audit-table health first.

## Heartbeat rows not appearing in sys_audit_log

In order: worker process up? (`/health` on 9464) → worker `/ready` green?
→ Redis reachable from the worker? → look for `"job failed"` logs →
`vidya_jobs_total{outcome="failure"}` increasing means the processor is
throwing (likely Postgres); not increasing at all means jobs aren't
arriving (Redis/scheduler).

## `pnpm lint` fails with a Constitution message

You imported across a module boundary (deep import, platform→module, or a
route file importing anything but the composition root). Restructure the
dependency — do **not** add an eslint-disable; reviewers treat that as a
blocker (ADR-0006). If it's a legitimate new element (new top-level
folder), extend the element map in `eslint.config.mjs` in the same PR.

## `check:ownership` fails

A migration or `pgTable()` targets a table outside your module's declared
prefix, or mentions another module's prefix / `platform_migrations`.
Rename the table or move the code to the owning module — cross-module data
access goes through the owning module's service API.

## Migration runner errors

- `no paired rollback file` — write the `.down.sql`; pairing is mandatory.
- `journal drift` / `ordering drift` — the database's journal disagrees
  with the files on disk (wrong branch checked out? deleted migration?).
  Restore the files; never hand-edit `platform_migrations`.
- Hangs at start — another migrator holds the advisory lock; find it via
  `SELECT * FROM pg_locks WHERE locktype = 'advisory';`.

## Integration tests fail locally

They need real services: `pnpm compose:up` first (or export
`DATABASE_URL`/`REDIS_URL` to a dev Postgres+Redis). Never point them at a
database you care about with `INTEGRATION_RESET_DB=true` — it drops the
public schema.

## Windows notes

- Use `pnpm` scripts directly if `make` is unavailable.
- If `pnpm` is not recognized after install, run `corepack enable` once in
  an elevated shell.
