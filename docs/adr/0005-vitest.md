# ADR-0005: Vitest as the test runner

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Tests must run against TypeScript-source workspace packages without a build
step, in two flavors: fast unit tests colocated with source, and serial
integration tests against real Postgres/Redis.

## Decision

**Vitest 3** with two projects in `vitest.config.ts`:

- `unit` — `packages/**` and `apps/**` colocated `*.test.ts`; runs with
  `--coverage` and the v8 provider; thresholds are the CI gate.
- `integration` — `tests/integration/**/*.int.test.ts`; global setup brings
  the target database to migration head via the real runner (ADR-0008);
  `--no-file-parallelism` because files share one database.

Coverage policy (approved amendment 3):

- **80% floor** (lines/branches/functions/statements) over platform +
  module source. Connection factories (`db/client`, `redis/client`,
  `queue/queue`, `storage/s3`) are excluded from the *unit* metric because
  their behavior is exercised by the integration suite, which v8 coverage
  does not merge.
- **Security-critical modules carry a near-exhaustive branch requirement**
  (target 100% of branches, each exception written down): first applies to
  Vidya #2's authenticator + scope-check policy. See
  docs/security-review.md#coverage-policy.

## Alternatives considered

- **Jest:** needs ts-jest/babel bridging for TS-source workspace packages
  and ESM; Vitest consumes them natively through Vite resolution.
- **node:test:** no coverage thresholds/projects ergonomics yet.

## Consequences

- One config file governs both suites; `pnpm test`, `pnpm test:coverage`,
  `pnpm test:integration` are the only entry points.
- Vitest is a root-only dependency; packages don't declare it (the runner
  provides the `vitest` import).
