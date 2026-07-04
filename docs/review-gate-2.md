# Post-Service Review Gate — Vidya #2 (inputs to a HUMAN approval decision)

Evidence for reviewers, not self-approval. "Verified" below = executed by
the author on Windows/Node 22/pnpm 11.9; Docker is unavailable on that
machine, so integration and compose verification is the human/CI gate.

## THE blocking item

**The human-owned security core does not exist yet.** By approved decision
#1, both processes fail closed at boot (`IdentityCoreNotProvidedError`) —
verified live: with the core absent every route, including /health, answers
500 with the explicit error. #2 is not acceptable until:

1. the security team lands `createIdentityCore()` in
   `packages/modules/identity/src/core/` (CODEOWNERS-routed) implementing
   `PasswordHasher` (argon2id), `SessionManager` (signed, Redis-backed) and
   `ScopeChecker` (the ADR-0010 matrix);
2. their implementation passes the three Fable-authored conformance suites
   (`src/core/conformance/`): hashing (7 cases), sessions (8 cases incl.
   TTL/idle against real Redis), scope-check (**60 matrix cases** + purity
   + matched-grant reporting);
3. a named human has read and understood those three implementations —
   the assignment's comprehension rule, which no test replaces.

## Architecture review

- Identity is a standard module under the #1 contract: `idn_` tables with
  shape/nesting CHECKs and a composite role-FK, own migrations (+rollback),
  13 routes, 1 job, public API = definition + factory + service.
- The #1 seams absorbed #2 exactly as designed: the composition change is
  the promised two-binding swap (SessionAuthenticator +
  RoleRequirementPolicy) plus injecting the ScopeChecker; the defineRoute
  pipeline gained params validation, origin guard and body cap — no
  structural rework.
- Boundary enforcement re-verified: a deep import into identity internals
  fails lint with the Constitution message (probe executed).
- The scope-check call-site pattern (`checkScope` in handlers, ResourceRef
  with org path + ownerUserId) is the exemplar #3 copies.

## Security review

docs/security-review.md (updated), docs/threat-model-identity.md,
ADR-0010/0011/0012. Highlights verified by tests: deny-by-default at three
layers (session → role gate → scope-check), uniform 401 + dummy-hash
enumeration resistance, lockout incl. correct-password-while-locked,
single-use hashed reset tokens never logged/audited, session invalidation
on every authority change, CSRF layers, audit coverage of login/logout/
role-change/scope-change (assignment requirement) plus failures.

**Spec decisions Fable made that need explicit human confirmation:**

1. `export` action allowed within read scope for hod/principal/admin only;
   denied to teacher/class_teacher (bulk-exfiltration control).
2. `approve` denied to teacher and class_teacher (hod-only write verb);
   class_teacher "promotion" writes are create/update on non-subject
   records, not `approve`.
3. Scope-denied `user-get` returns 403 (not existence-hiding 404) — ids are
   opaque UUIDs, enumeration value judged low.
4. `must_reset` is disclosed only after a correct password (403) — a
   deliberate, documented divergence from the uniform 401.
5. Admin management routes both require the admin role AND scope-check
   against the target college (multi-college future-proofing).

## Test coverage summary

- **Unit: 165 tests, 24 files — executed, green.** Coverage gate ≥80%
  global (measured 86.8% lines / 90.5% branches); the security-path gate
  on `identity/src/service/**` at 95 (measured 99.5% lines / 95.1%
  branches / 100% functions — residual branches are `?? null` view
  fallbacks). Excluded from the unit metric and why: Drizzle repos + schema
  (integration-tested), `core/` (human-owned), module `index.ts`
  (requires the core), `providers/` (type-only contract).
- **Integration: 3 files from #1 updated + identity-flow.int.test.ts (10
  tests; 23 total) — written, NOT executed locally (no Docker); run in
  CI.** Cover:
  full login→whoami→logout with audit assertions, admin user lifecycle,
  must_reset → admin token → confirm → login, token single-use, self-access
  vs foreign profile, role-gate for non-admins, grant add/remove with
  cascade FK, role change killing sessions with before/after audit, and
  real-Redis lockout with Retry-After.
- Interim testing uses labeled insecure doubles (ADR-0012); the conformance
  

## Performance & API reviews

docs/performance.md (#2 section): argon2 dominates login by design;
authenticated requests cost one Redis round-trip; scope-check is pure
in-memory. OpenAPI regenerated from RouteSpecs: 13 identity operations,
params/query/body schemas, cookie security scheme, per-route auth notes;
CI drift check green.

## Technical debt added

| Item | Why accepted | Trigger |
|---|---|---|
| Admin list endpoints hydrate roles/grants N+1 | Admin tooling, paginated ≤200 | Appearing on a hot path |
| Scope-check call-site discipline is convention + review for future modules | Lint can't see semantics of "data access" yet | #3: add a heuristic lint (repo access outside a checkScope'd handler) |
| Session doubles diverge from real core behavior until it lands | Unavoidable under the ownership split | Re-run identity-flow suite against the real core (one-line swap in the test) — make it part of core acceptance |
| `user-list` collegeId is caller-supplied | Scope-check validates it | #3's OrgDirectory can enumerate the caller's colleges instead |

## Items requiring human action before approval

1. Deliver + review the security core (THE blocking item above).
2. Confirm spec decisions 1–5.
3. Run integration + compose on a Docker machine after the core lands
   (`pnpm test:integration`, compose green path incl. create-admin →
   login → curl flows).
4. Replace `@vidya-security-team` in CODEOWNERS with the real handle.
5. Re-confirm the ASVS open items (MFA, TLS-to-backends, restricted DB
   roles, secret scanning) against institutional policy.
