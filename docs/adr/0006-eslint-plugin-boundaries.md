# ADR-0006: Boundary enforcement — eslint-plugin-boundaries + no-restricted-imports + exports maps

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Constitution rule 3 requires that cross-module deep imports FAIL the build.
A convention in a README does not satisfy this; an executable rule does.

## Decision

Three independent layers (all verified by deliberate-violation probes
during #1's implementation):

1. **`eslint-plugin-boundaries`** (`boundaries/element-types`, default
   **disallow**) classifies every file into elements — `module-public`
   (a module's `index.ts`), `module-internal`, `platform`,
   `web-composition`, `web-route`, `web-app`, `worker-app`, `scripts`,
   `tests` — and allows only:
   - platform → platform;
   - module → itself, any `module-public`, platform;
   - **route files → the composition root only** (this is what makes
     "every route passes the auth/audit/validation pipeline" structural
     rather than disciplinary);
   - apps/scripts/tests → platform + `module-public`.
   Resolution uses `eslint-import-resolver-typescript` across all package
   tsconfigs.
2. **`no-restricted-imports`** bans `@vidya/module-*/...` subpaths
   everywhere and any `@vidya/module-*` import inside `packages/platform`
   — a resolver-independent belt-and-braces.
3. **Package `exports` maps** — deep imports don't even resolve at runtime
   or in `tsc`.

Table access is covered by the same mechanism (schema objects are
module-internal) plus `scripts/check-table-ownership.ts` (prefix scan of
migrations SQL and `pgTable()` declarations, and a cross-prefix mention
scan), which runs in CI.

## Consequences

- `pnpm lint` failing on a boundary message is a Constitution violation,
  not a style nit; it must never be suppressed with an inline disable —
  treat any `eslint-disable` mentioning `boundaries/` or
  `no-restricted-imports` as a review blocker.
- New top-level folders must be added to the element map or imports from
  them are rejected by default (fail-closed).
- The ownership check is a heuristic (regex over SQL/TS); reviewers remain
  the final gate for exotic SQL. Known residual risk is documented in
  docs/review-gate.md.
