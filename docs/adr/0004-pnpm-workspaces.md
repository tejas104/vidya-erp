# ADR-0004: pnpm workspaces; one package per module

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

The monorepo needs (a) shared code between web and worker, (b) hard module
boundaries, (c) reproducible installs on-premise.

## Decision

- **pnpm** (v11, pinned via `packageManager` + corepack) with workspaces:
  `apps/*`, `packages/*`, `packages/modules/*`.
- **Each feature module is its own workspace package** (`@vidya/module-*`)
  whose `exports` map exposes only `./src/index.ts` (+ `package.json`).
  Deep imports fail at *module resolution*, independent of lint — two
  independent enforcement layers for Constitution rule 3.
- pnpm's strict, non-flat `node_modules` means a package can only import
  what it declares — no phantom cross-module dependencies.
- Internal packages ship TypeScript source; Next transpiles them
  (`transpilePackages`), the worker runs them via tsx, and `tsc --noEmit`
  per package is the type gate. No intermediate build artifacts to drift.

## Alternatives considered

- **Single package, folder-per-module:** simpler, but boundaries rest on
  lint alone and extraction (ADR-0001) requires repackaging.
- **npm/yarn workspaces:** flat hoisting weakens the "declare what you
  import" property that pnpm gives for free.

## Consequences

- Adding a module = adding a package (see docs/how-to-add-a-module.md);
  slightly more ceremony, much stronger seams.
- `pnpm install --frozen-lockfile` is the only sanctioned install in CI and
  containers.
- Build scripts of dependencies are opt-in (`allowBuilds` in
  pnpm-workspace.yaml), each approval justified in ADR-0009.
