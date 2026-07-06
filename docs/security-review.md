# Security review — Vidya #1 foundation + #2 identity + #3 people + #4 academics

## <a id="aggregation-scope"></a>#5: Scope-filtered aggregation + the minimum-cohort rule (EXECUTED)

Analytics never aggregate-then-check. Two properties, both executed against
the REAL matrix in `analytics/src/aggregation-scope.test.ts` (unit) and
re-proven over real records in `tests/integration/analytics-flow.int.test.ts`:

1. **Constituent-closure.** An aggregate is served only if the caller could
   read every constituent record. Attendance and single-subject marks
   rollups reduce to one check on the node's constituent ref; cross-subject
   marks check every subject explicitly (a math teacher is DENIED the class
   overall at the physics constituent — the differencing leak, closed).
   Precomputed rollups are computed BLIND and stored with their node's
   position; disclosure happens only at serve time. Live per-student views
   filter per record before any arithmetic, and show an overall only when
   nothing was filtered out.
2. **Minimum-cohort (unconditional, K=5).** Any aggregate over < 5 distinct
   students is withheld for EVERY role — `cohortSufficient` takes no
   principal, so there is no bypass. It fails closed for future consumers.
   Applied to rollups, monthly points and register-strip cells alike.

Field-gating on at-risk: attendance component by section coverage,
per-subject scores by subject scope, overall + low-marks reason only under
closure. The dashboard is the permission mirror (tiles from grants). Full
detail + worked-example table: ADR-0018; leak analysis:
docs/threat-model-analytics.md. **The worked examples require human
verification** (review-gate-5). #5 required ZERO human-core changes.

## <a id="worked-scope-traces"></a>#4: The worked scope traces (EXECUTED, not argued)

Every trace below is executed against the REAL human-owned ScopeChecker
with ResourceRefs built by the module's actual builders — in
`packages/modules/academics/src/scope-traces.test.ts` (unit, 11 tests) and
re-verified LIVE in `tests/integration/academics-flow.int.test.ts` with
real logged-in teachers holding #3-derived grants. **A human must read the
trace file against the matrix as an acceptance item (review-gate-4).**

| # | Trace | Verdict |
|---|---|---|
| 1 | teacher reads own-subject marks across their class | **GRANTED** |
| 2 | teacher reads another subject's marks, same class | **DENIED** |
| 3 | teacher reads attendance across their class's sections | **GRANTED** |
| 4 | teacher writes marks for a subject not theirs | **DENIED** |
| 4b | teacher writes own class+subject marks | **GRANTED** |
| 4c | teacher writes attendance (non-subject record) | **DENIED** |
| 5 | class_teacher writes attendance / writes marks / reads all subjects' marks | **GRANTED / DENIED / GRANTED** |
| 6 | hod & principal read marks+attendance / routine writes | **GRANTED / DENIED** |
| 7 | admin reads academic data / writes any of it | **GRANTED / DENIED** |
| 8 | anything across class or college boundaries | **DENIED** |
| 9 | assessment creation: subject teacher / class_teacher / admin | **GRANTED / DENIED / DENIED** |

Why the traces cannot rot: the subjectId bit is set by construction
(ADR-0017 — attendance refs cannot carry one, marks refs always do, from
the stored row, never caller input), the builder file has a 100% coverage
gate, and org paths are stamped from the PeopleDirectory at write time.
Grade-change integrity: every entry and correction audits before/after
with actor into the append-only log; `GET /marks/{id}/history` surfaces
the trail, scope-checked like the mark itself. #4 required ZERO changes
to the human-owned core (ADR-0016 honored).


> #3 delta summary: the people module makes the scope model operational
> against real domain records — every read AND write flows through the
> human-owned ScopeChecker with org positions derived from live data
> (students positioned by enrollment; transfers checked on BOTH sides).
> The one matrix change (admin writes for people records) was owner-
> authorized and conformance-pinned (ADR-0013). The new security-relevant
> surface is the assignment→grant derivation seam (ADR-0015): compensated
> dual-writes, provenance-tagged grants immune to manual edits, session
> invalidation on every authority change, and an hourly audited
> reconciliation. Bulk import validates per row, caps body size, stores
> CSVs privately, and audits actor+counts. Threat model:
> docs/threat-model-people.md.

> #2 delta summary: the deny-all gate is replaced by real session
> authentication + role/scope authorization. Credential verification,
> s
> behind a verified fail-closed boot gate until that code lands. New
> defenses active: login/reset throttling with lockout, origin guard +
> SameSite=Strict CSRF layers, request body cap, admin-only one-time reset
> tokens (hash-at-rest), uniform-401 + dummy-hash enumeration resistance,
> session invalidation on every authority change. Threat model:
> docs/threat-model-identity.md. Decisions: ADR-0010/0011/0012.

## Auth seam & deny-by-default posture

- Every route is built by `defineRoute`; a route is authenticated unless
  its RouteSpec says `public: true` **with a recorded reason** (flows into
  OpenAPI). The only public routes are `system.health/ready/metrics`.
- `DenyAllAuthenticator` + `DenyAllAccessPolicy` are the phase-1
  implementations: real 401/deny behavior, clearly labeled contracts — not
  fake verifiers. Verified by unit tests and a live smoke test.
- The seam is shaped for #2 (approved amendment 4): `Principal` carries
  `roles`/`scopes`/`sessionId`; `AccessRequirement` (`rolesAnyOf`,
  `scopesAllOf`) is declared per route; the pipeline already calls
  `AccessPolicy.authorize(principal, requirement, ctx)` after
  authentication (proven by unit tests that inject an allowing
  authenticator). #2 swaps two bindings in the composition roots — zero
  pipeline changes.
- Bypass resistance is structural: route files may import only the
  composition root (boundary lint), so no route can skip the gate.

## Input validation

- zod at every boundary: env config (values never echoed on failure),
  query/body per route (400 with paths+messages), job payloads
  (UnrecoverableError on mismatch), request-id header allowlist.

## Audit

- State-changing RouteSpecs must declare an audit action or `defineRoute`
  throws at composition time; audit write failure fails the request
  (fail-closed, unit-tested). Storage is append-only at the database level
  (triggers, integration-tested including TRUNCATE).

## Secrets

- No secrets in source. `.env` git-ignored; `.env.example` and compose
  carry clearly-labeled local-dev-only defaults, overridable via
  environment. Production injects env vars at runtime (secret manager /
  orchestrator). Config loader redacts by construction; pino redacts
  common credential paths.

## Container hardening

- Both images: non-root `USER node`, pinned base (`node:22-alpine`),
  multi-stage web build shipping only traced standalone output, no build
  tools in the web runtime image, healthchecks defined, single process per
  container.

## <a id="coverage-policy"></a>Coverage policy for security-critical code

Approved amendment 3: the repository floor is 80% (CI-gated). Components
on a privilege boundary carry a **near-exhaustive branch-coverage
requirement — target 100% of branches, every uncovered branch individually
justified in the PR**. Applies first to Vidya #2's authenticator and the

auth/audit branching in `define-route.ts` already meets it (93.9% branches,
the remainder being defensive `??` fallbacks).

## OWASP ASVS Level 2 position

Conformant now (for the surface that exists): V1 architecture
documentation, V4 access-control-by-default, V5 input validation, V7 error
handling & logging, V8 audit trail, V10 configuration, V12/V14 build &
dependency hygiene (lockfile, opt-in build scripts, CI gates).

**Gap status after #2:**

| Gap | ASVS area | Status |
|---|---|---|
| Authentication/session management | V2, V3 | **Closed by #2** (pending the human core landing): argon2 hashing + Redis sessions behind conformance suites; fail-closed boot until then. |
| Brute-force controls on auth endpoints | V11 | **Closed by #2**: Redis lockout on login and reset redemption, audited. |
| Request body-size limit | V13 | **Closed by #2**: pipeline 413 cap (config `BODY_MAX_BYTES`). |
| CSRF defenses | V4.2 | **Closed by #2** for the current API surface: SameSite=Strict + origin guard; double-submit tokens deferred to the first browser UI (ADR-0011). |
| MFA | V2.8 | Open — institutional policy decision; login-flow seam exists. |
| Global (non-auth) rate limiting | V11 | Open — revisit when #3 adds data-heavy endpoints. |
| Redis/Postgres/MinIO without TLS+auth in compose | V9 | Open (local-dev stack); production requires the proxy/TLS posture in the runbook. Redis now holds sessions — production Redis MUST have AUTH + network isolation. |
| Restricted DB roles (app user without DDL, migrator separate) | V1.4 | Open; urgency raised now that credential hashes live in the DB. |
| Dependency/secret scanning automation | V14 | Open; still a one-line CI addition, re-flagged in review-gate-2. |
