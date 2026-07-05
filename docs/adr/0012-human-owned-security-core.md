# ADR-0012: Human-owned security core — ownership mechanics

- **Status:** Accepted (implements the assignment #2 ownership split).
  **Update 2026-07-04:** the security team landed all three
  implementations; `createIdentityCore()` is wired (fail-closed gate
  retired) and the platform boots end-to-end. The matrix was extended once
  under owner authorization — see ADR-0013.
  **Update 2026-07-05:** both owner-authorized edits (the wiring and the
  ADR-0013 extension) were ratified; the standing change-control rule for
  any future edit to this human-owned boundary is ADR-0016.
- **Date:** 2026-07-04

## The split

| Component | Owner | Fable's role |
|---|---|---|
| `PasswordHasher` (argon2 hash/verify/rehash) | **Human team** | interface, conformance suite, calling plumbing |
| `SessionManager` (issue/resolve/invalidate, Redis, signing) | **Human team** | interface, conformance suite, cookie transport, authenticator |
| `ScopeChecker` (the ADR-0010 matrix) | **Human team** | interface, the matrix-as-conformance-suite, every call site |
| Everything else in the identity module | Fable | authored under review |

## Mechanics

- Implementations live in `packages/modules/identity/src/core/` —
  CODEOWNERS routes any change there to the security team.
- `src/core/index.ts` currently exports a **fail-closed gate**:
  `createIdentityCore()` throws `IdentityCoreNotProvidedError`. Both
  composition roots call it at boot, so **no process starts half-secured**
  (verified live: with the core absent, every route including /health
  answers 500 with the explicit error). The human PR replaces the throw
  with the real factory; nothing else changes.
- **Acceptance = conformance + comprehension.** The implementation must
  pass the three Fable-authored conformance suites
  (`src/core/conformance/*`, invoked from the implementation's own test
  files, run in the integration project against real Redis), AND a named
  human must have read and understood the code itself — passing Fable's
  tests is necessary, not sufficient.
- Interim testing: Fable's unit/integration suites run against **labeled,
  deliberately insecure test doubles** (`test-support/fakes.ts`,
  `tests/integration/support/identity-test-core.ts`). The doubles exercise
  plumbing only; the scope-checker double implements two stub rules, not
  the matrix, precisely so it can never masquerade as the real thing.

## Consequences

- The repository is intentionally not bootable end-to-end until the human
  core lands — tracked as THE blocking item in docs/review-gate-2.md.
- Conformance suites are part of the trust surface: editing a scope case is
  editing the platform's permission matrix and reviews accordingly (the
  suites are CODEOWNERS-routed to the security team too).
