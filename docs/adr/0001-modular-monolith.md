# ADR-0001: Modular monolith — Constitution rules 1–3 at module granularity

- **Status:** Accepted (approved constitution exception for the monolith phase)
- **Date:** 2026-07-02
- **Owner:** Vidya #1

## Context

The Platform Constitution demands extractable, table-owning, interface-only
components (rules 1–3). At institutional scale (one college, thousands —
not millions — of users) separate services would multiply operational cost
without load justification, especially on-premise.

## Decision

Rules 1–3 apply at **module** granularity inside one deployable web app +
one worker, sharing one Postgres instance:

1. **Module = pnpm workspace package** under `packages/modules/<name>`,
   exporting only `src/index.ts` (enforced by the package `exports` map at
   resolution level and by ESLint at review level — ADR-0006).
2. **Table ownership by prefix** (`sys_` for system). Schema objects are
   module-internal; `scripts/check-table-ownership.ts` verifies every DDL
   statement and `pgTable()` declaration in CI. The single exception is the
   platform-owned `platform_migrations` journal (ADR-0008).
3. **Interaction through the module contract** (`VidyaModule` in
   `packages/platform/src/contracts/module.ts`): static definition (routes,
   jobs, migrations, table prefix) + factory returning handlers, processors
   and the public service API. Composition roots in `apps/web` and
   `apps/worker` are the only places modules are instantiated and wired.

The platform layer (`packages/platform`) is shared infrastructure, never
imports modules, and owns no business tables.

## Extraction path to services

When a module must become a service:

1. Lift its package into its own repository/deployable — the folder already
   is the service boundary.
2. Replace its entry in the composition roots with an HTTP client that
   implements the same public service interface (`SystemService` et al.);
   version it as `/api/v1/...` per rule 4/5.
3. Move its tables (already exclusively prefix-owned, already migrated by
   its own migration directory) to its own database with a standard
   dual-write/backfill cutover.
4. Its jobs already run on its own BullMQ queue (queue name = module name);
   point the extracted service's worker at the same queue or a new Redis.

What would make extraction hard — and is therefore banned now: cross-module
joins (impossible: schemas are internal), shared tables (ownership check),
in-process event assumptions (only BullMQ jobs cross process boundaries).

## Consequences

- One database to operate; boundaries are enforced by tooling, not network.
- Boundary enforcement is only as strong as CI — bypassing lint is a
  constitution violation reviewers must treat as a blocker.
- Transactions cannot span modules by construction of the public-interface
  rule; cross-module workflows must use jobs/sagas (first needed in later
  assignments).
