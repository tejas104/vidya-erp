# Project Vidya — modular-monolith foundation (#1)

On-premise College Information & Analytics System. This repository
contains assignment #1: the Next.js modular-monolith skeleton — module
system with build-failing boundaries, web+worker split, shared
infrastructure, audit log, migration harness, observability — that every
future Vidya module plugs into. **No business features exist yet by
design;** authentication arrives in #2.

## Layout

```
apps/web                  Next.js shell: thin route files + composition root
apps/worker               BullMQ worker: job processors + composition root
packages/platform         shared infra (config, pino, pg/drizzle, redis,
                          bullmq, s3, http pipeline, auth/audit seams,
                          lifecycle, migration runner) — imports NO module
packages/modules/system   reference module: health/ready/metrics,
                          append-only audit log (sys_), heartbeat job
scripts/                  migrate, openapi, todo/ownership checks, registry
tests/integration         Postgres/Redis/BullMQ end-to-end suite
docs/                     ADRs, diagrams, threat model, runbook, reviews
```

Start with `docs/adr/0001-modular-monolith.md` and
`docs/how-to-add-a-module.md`.

## Prerequisites

Node ≥ 22, corepack (`corepack enable` once — pnpm is pinned via
`packageManager`), Docker (for compose/integration tests).

## Install, build, run, test — exact commands

```bash
pnpm install --frozen-lockfile

# full local stack: postgres + redis + minio + one-shot migrate + web + worker
pnpm compose:up
curl -s http://localhost:3000/ready     # → {"status":"ready","checks":[{"name":"postgres","ok":true},{"name":"redis","ok":true}]}
curl -s http://localhost:3000/health    # → {"status":"ok","uptimeSeconds":…,"version":"0.1.0"}
curl -s http://localhost:3000/metrics | head   # Prometheus text
curl -s http://localhost:9464/ready     # worker replica probe
pnpm compose:down

# dev without containers for the app processes (services still via compose)
pnpm dev          # web on :3000
pnpm dev:worker   # worker (second terminal)

# quality gates (what CI runs)
pnpm typecheck && pnpm lint && pnpm test:coverage
pnpm check:todos && pnpm check:ownership && pnpm openapi:check

# database
pnpm db:migrate ; pnpm db:status ; pnpm db:rollback

# integration suite (needs DATABASE_URL/REDIS_URL, e.g. the compose stack)
pnpm test:integration
```

### Expected green-path output

- `pnpm test:coverage` → `Test Files 15 passed`, `Tests 77 passed`,
  coverage ≥ 80% on all four axes (verified: 83.9% stmts / 95.2% branch).
- `pnpm lint` → exit 0. (Try a deep import like
  `import x from "@vidya/module-system/src/db/schema"` anywhere — the
  build fails with a Constitution message. That's the feature.)
- `pnpm db:migrate` → `applied  system/0000_audit_log`.
- `pnpm test:integration` → 13 tests across migrations (up/down/up),
  append-only audit enforcement, and the heartbeat job end-to-end
  (enqueue → Redis → BullMQ worker → audit row).
- Every API response carries `x-request-id`; every non-public route
  answers `401` until #2 (deny-by-default is real).

## The rules that bite (on purpose)

- Modules are sealed: import another module's package root only; its
  tables are untouchable; lint + package exports + CI ownership check all
  fail the build on violations.
- Every state-changing route must declare an audit action; audit-write
  failure fails the request.
- Every migration ships its rollback or nothing runs (ADR-0008 — flagged
  for human review).
- No TODO/FIXME-style markers in non-test code — CI scans for them.

## Documentation index

ADRs 0001–0009 (`docs/adr/`), component/request/database diagrams
(`docs/diagrams/`), `docs/threat-model.md`, `docs/security-review.md`,
`docs/performance.md`, `docs/runbook.md`, `docs/troubleshooting.md`,
`docs/how-to-add-a-module.md`, OpenAPI at `docs/openapi/openapi.json`,
and the human-approval package in `docs/review-gate.md`.
