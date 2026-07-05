# Project Vidya — modular monolith (#1 foundation, #2 identity, #3 people)

On-premise College Information & Analytics System. Assignment #1 built the
Next.js modular-monolith skeleton (module system with build-failing
boundaries, web+worker split, audit log, migration harness,
observability). Assignment #2 added the identity module: users, roles,
scope grants, Redis sessions, login/logout/reset, and the role+scope
authorization model (ADR-0010) — its security core (argon2id hashing,
split-token Redis sessions, the scope-check matrix) is HUMAN-OWNED,
implemented and wired (ADR-0012/0013). Assignment #3 adds the people
module: the canonical org tree (college→department→class→section +
subjects), student/teacher records, enrollment, teacher assignments as the
source of truth for DERIVED identity grants, the OrgDirectory that
verifies grants, and bulk CSV import through the worker.

## Layout

```
apps/web                  Next.js shell: thin route files + composition root
apps/worker               BullMQ worker: job processors + composition root
packages/platform         shared infra (config, pino, pg/drizzle, redis,
                          bullmq, s3, http pipeline, auth/audit seams,
                          lifecycle, migration runner) — imports NO module
packages/modules/system   reference module: health/ready/metrics,
                          append-only audit log (sys_), heartbeat job
packages/modules/identity identity & access (idn_): users, roles, scope
                          grants, sessions; src/core is the HUMAN-OWNED
                          security core (CODEOWNERS)
packages/modules/people   org tree, students/teachers, enrollment,
                          assignments → derived grants, CSV import (ppl_)
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

# one-time platform bootstrap (after the human core lands)
VIDYA_ADMIN_PASSWORD=<strong> pnpm exec tsx scripts/create-admin.ts \
  --username root-admin --display-name "Root Admin" --college-id col-main

# integration suite (needs DATABASE_URL/REDIS_URL, e.g. the compose stack)
pnpm test:integration
```

### Expected green-path output

- `pnpm test:coverage` → `Test Files 34 passed`, `Tests 329 passed`,
  coverage ≥ 80% globally (verified 91.7% / 86.6% branches), ≥ 95% on
  `identity/src/service/**` and on the grant-derivation seam
  (`people/src/service/assignments-service.ts`).
- `pnpm lint` → exit 0. (Try a deep import like
  `import x from "@vidya/module-people/src/db/schema"` anywhere — the
  build fails with a Constitution message. That's the feature.)
- `pnpm db:migrate` → `system/0000_audit_log`, `identity/0000_identity`,
  `identity/0001_grant_provenance`, `people/0000_people`.
- `pnpm test:integration` (CI / Docker machine, incl. MinIO) → migrations
  up/down/up across all modules, append-only audit enforcement, the
  heartbeat job, identity flows against the REAL security core (argon2 +
  the live scope matrix), people org administration, the full
  assignment→derived-grant→session-invalidation loop, the grants-verify
  backfill, and MinIO-backed CSV imports (dry-run + apply + per-row
  errors).
- Every API response carries `x-request-id`; non-public routes answer 401
  without a valid `vidya_session` cookie; people routes are never public.

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
