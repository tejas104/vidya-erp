# Post-Service Review Gate — Vidya #1 (inputs to a HUMAN approval decision)

This is evidence for reviewers, not a self-approval. Verification that the
code compiles/runs on a clean machine and against the compose stack is a
human gate (Constitution rule 20); the "verified" claims below state
exactly what was executed during authoring, on Windows, Node 22.14,
pnpm 11.9.

## Architecture review

- Module contract (`VidyaModule`) separates static definition (tooling)
  from runtime factory (composition) — one reference implementation
  (system) exercises every clause: routes, jobs, table ownership,
  migrations, service API, readiness.
- Composition roots are the only module-aware code; platform is
  module-blind; route files are one-import thin. Dependency direction is
  strictly apps → modules → platform.
- Boundary enforcement is triple-layered (lint, package exports, ownership
  CI script) and was **verified to fail** on three deliberate violation
  probes (deep package import, platform→module, relative cross-package).
- Extraction path documented (ADR-0001). Risk to watch: composition roots
  grow linearly with modules; acceptable through ~10 modules, then
  consider generated registration.

## Security review

See docs/security-review.md and docs/threat-model.md. Highlights:
deny-by-default is structural and live-tested (401 + challenge observed);
audit is fail-closed and DB-level append-only (integration-tested incl.
TRUNCATE); config errors never echo values; problem+json leaks no
internals; containers run non-root. ASVS L2 gaps are enumerated with
owners/phases (auth #2, rate limiting #2, TLS-to-backends ops, restricted
DB roles, CI secret scanning).

## Performance review

See docs/performance.md: pool budget math, replica model, ranked
first-bottleneck list (audit insert → connection ceiling → framework
overhead). Nothing benchmarked yet — no business endpoint exists; this is
deliberate.

## API review

Three routes, all GET, all public-with-justification, all versioned, all
aliased to conventional probe paths via rewrites (rule 5 + rule 8
reconciliation as approved). OpenAPI 3.0.3 generated from the same zod
schemas the pipeline enforces; CI fails on drift. 401/403 responses
auto-documented for authenticated routes. problem+json error envelope
uniform across the pipeline.

## Test coverage summary

- **Unit: 77 tests, 15 files — executed, all passing.** Coverage gate ≥80%
  on statements/branches/functions/lines; measured 83.9% / 95.2% / 80.4% /
  83.9%. Pipeline auth/authz/validation/audit branching, config loader,
  migrator planning, lifecycle, module conformance.
- **Integration: 13 tests, 3 files — written, NOT executed locally
  (Docker unavailable on the authoring machine); they run in CI and
  against compose.** Cover migration up/down/up + journal + advisory-lock
  concurrency + drift refusal; append-only audit enforcement; heartbeat
  end-to-end through Redis/BullMQ/Postgres including the
  malformed-payload no-retry path.
- **Not executed by the author (human gate):** docker image builds,
  compose stack, CI workflow itself, `next start` smoke WAS executed
  (health 200 / ready 503-unready / metrics OK, x-request-id + security
  headers observed).

## Technical debt register

| Item | Why accepted | Trigger to pay |
|---|---|---|
| Worker runs via tsx, not compiled JS | tsc gate covers type safety; single build system | Cold-start SLO or supply-chain policy requiring dist-only images |
| Worker image carries dev deps (full install) | Simplicity; image size only | Image-size/pull-time budgets |
| `RouteContext.request.query/body` typed `unknown` (handlers narrow) | No input-taking routes exist yet | First real input route (#2) adds generic typing |
| Ownership check is regex-heuristic over SQL | Structural layers (exports/lint) do the heavy lifting | Any dynamic SQL feature |
| Coverage excludes infra connection factories from the unit metric | Integration-covered; v8 can't merge suites | Coverage merging tooling, or move factories behind testable seams |
| No pgbouncer / restricted DB roles / TLS to backends in dev stack | Local-dev scope | Production deployment hardening milestone |
| No dependency-audit/secret-scan CI step | Time-boxing #1 | One-line CI additions — recommend before #2 merge |

## Future risks

1. **ADR-0008 runner is load-bearing and data-destructive** — the reason
   it is human-review-flagged; see its "review questions" section.
2. Next.js major upgrades can shift route-handler/instrumentation
   semantics — the composition indirection contains the blast radius, but
   pin-and-test discipline is required (Next is pinned via lockfile).
3. The deny-all → real-auth swap in #2 is THE security-critical diff of
   the platform's life; the seam is tested, but the swap PR needs the
   near-exhaustive coverage policy and its own threat-model delta.
4. Audit-table growth is unbounded (append-only by design) — partitioning
   or archival policy needed before high-volume modules (attendance).

## Items requiring human action before approval

1. Review ADR-0008 (migrator) line by line — the flagged component.
2. Run the full green path on a Docker-capable machine:
   `pnpm install --frozen-lockfile && pnpm compose:up` → probes green →
   `pnpm test:integration` → `pnpm compose:down`.
3. Push to GitHub and confirm the CI workflow passes end to end (it has
   never run — no remote existed during authoring).
4. Decide the two ADR-0008 open questions (statement splitting, rollback
   guard) — answers shape #2's migration additions.
5. Confirm the ASVS gap schedule (docs/security-review.md) matches
   institutional expectations.
