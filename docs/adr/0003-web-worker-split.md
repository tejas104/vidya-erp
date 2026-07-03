# ADR-0003: Separate web and worker processes sharing module code

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Background work (imports, report generation, notifications — all future)
must not compete with request latency, must survive web deploys/restarts,
and must retry safely. The Constitution mandates BullMQ on Redis with a
worker separate from the web process.

## Decision

Two processes, two containers, one monorepo, same module code:

- **`apps/web`** — Next.js (App Router) serving `/api/v1/...`. Instantiates
  each module's route handlers through the `defineRoute` pipeline.
- **`apps/worker`** — a plain Node process (run via tsx, ADR-0009) that
  instantiates the same modules but registers their `JobSpec`s as BullMQ
  workers (one queue per module, queue name = module name), plus repeatable
  schedules (`upsertJobScheduler`, idempotent across replicas). It exposes
  `/health`, `/ready`, `/metrics` on its own port (9464) so every replica
  type is probeable (rules 8–9).

Contract details:

- Job payloads are zod-validated before the processor runs; malformed
  payloads are `UnrecoverableError` (no retries — retrying cannot fix a bad
  payload). Default policy otherwise: 3 attempts, exponential backoff.
- Enqueueing from web code goes through `createModuleQueue` (platform);
  processors only ever run in the worker.
- Both processes are stateless (rule 10); BullMQ coordinates ownership in
  Redis, so N web × M worker replicas are safe.

## Consequences

- A job's failure semantics are explicit and observable
  (`vidya_jobs_total{outcome}`).
- The worker restarts independently of web deploys; graceful shutdown waits
  for in-flight jobs (`worker.close()`).
- Local dev needs two processes (`pnpm dev`, `pnpm dev:worker`) or compose.
