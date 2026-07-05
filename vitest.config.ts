import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
          // The argon2 conformance tests hash with production cost
          // parameters (64 MiB, t=3) — deliberately slow.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.int.test.ts"],
          globalSetup: "./tests/integration/global-setup.ts",
          hookTimeout: 60_000,
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Coverage policy (approved amendment 3): 80% floor on unit-testable
      // platform + module source. Infrastructure connection factories are
      // excluded here because their behavior is exercised by the
      // integration suite against real Postgres/Redis, which vitest does
      // not merge into unit coverage. Security-critical modules (#2's
      // scope-check onward) carry a near-exhaustive branch requirement —
      // see docs/security-review.md#coverage-policy.
      include: ["packages/platform/src/**", "packages/modules/*/src/**"],
      exclude: [
        "**/*.test.ts",
        "packages/platform/src/index.ts",
        "packages/platform/src/db/client.ts",
        "packages/platform/src/redis/client.ts",
        "packages/platform/src/queue/queue.ts",
        "packages/platform/src/storage/s3.ts",
        // Identity: Drizzle repositories and schema are exercised by the
        // integration suite against real Postgres; the core/ subtree is

        // providers/ is a type-only contract.
        "packages/modules/identity/src/repo/**",
        "packages/modules/identity/src/db/**",
        "packages/modules/identity/src/core/**",
        "packages/modules/identity/src/index.ts",
        "packages/modules/identity/src/providers/**",
        // People: same policy — Drizzle repos/schema and the composition
        // glue in index.ts are integration-tested against real services.
        "packages/modules/people/src/repo/**",
        "packages/modules/people/src/db/**",
        "packages/modules/people/src/index.ts",
        // Academics: same policy.
        "packages/modules/academics/src/repo/**",
        "packages/modules/academics/src/db/**",
        "packages/modules/academics/src/index.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Security-critical coverage policy (approved amendment 3, #1):
        // identity's Fable-owned auth plumbing carries a near-exhaustive
        // branch requirement.
        "packages/modules/identity/src/service/**": {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        // The grant-derivation seam (ADR-0015) is security-relevant: same bar.
        "packages/modules/people/src/service/assignments-service.ts": {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        // #4: the scope-integration surface (ref builders) and the services
        // that feed it carry the security bar.
        "packages/modules/academics/src/resource-refs.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        "packages/modules/academics/src/service/**": {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
      },
    },
  },
});
