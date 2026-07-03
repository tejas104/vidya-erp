# Security review — Vidya #1 foundation

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
human-authored scope-check `AccessPolicy`; in #1 the pipeline's
auth/audit branching in `define-route.ts` already meets it (93.9% branches,
the remainder being defensive `??` fallbacks).

## OWASP ASVS Level 2 position

Conformant now (for the surface that exists): V1 architecture
documentation, V4 access-control-by-default, V5 input validation, V7 error
handling & logging, V8 audit trail, V10 configuration, V12/V14 build &
dependency hygiene (lockfile, opt-in build scripts, CI gates).

**Known gaps, owned and scheduled:**

| Gap | ASVS area | Plan |
|---|---|---|
| No authentication/session management | V2, V3 | Vidya #2 (sessions in Redis, the whole point of the seam). |
| No rate limiting / brute-force controls | V11 | With #2's login surface. |
| No explicit request body-size limit beyond Next defaults | V13 | With first write route (#2). |
| No CSRF defenses | V4.2 | With cookie sessions (#2); design decision recorded there. |
| Redis/Postgres/MinIO without TLS+auth in compose | V9 | Compose is local-dev; production deployment guide (runbook) requires network isolation + credentials; TLS-everywhere is an ops milestone. |
| Restricted DB roles (app user without DDL, migrator separate) | V1.4 | Scheduled hardening; today one role does both in dev. |
| Dependency/secret scanning automation (audit, gitleaks) | V14 | CI addition, low effort, flagged in review gate. |
