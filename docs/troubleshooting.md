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

## 401 on every API route

Working as designed in Vidya #1: authentication ships in #2; the deny-all
gate answers 401 with `WWW-Authenticate: Bearer realm="vidya"` on every
non-public route. Only `/health`, `/ready`, `/metrics` (and their
`/api/v1/system/*` canonical forms) are public.

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
