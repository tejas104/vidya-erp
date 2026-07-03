# ADR-0002: Drizzle ORM + drizzle-kit for the data layer

- **Status:** Accepted (stack locked by the Constitution; this records the rationale)
- **Date:** 2026-07-02

## Context

The platform needs typed Postgres access with explicit SQL, per-module
schema files, and a migration story compatible with per-module ownership.

## Decision

- **drizzle-orm** (`node-postgres` driver over a shared `pg.Pool`) for
  queries. Schema objects live inside each module (`src/db/schema.ts`),
  are NOT exported from the module's public API, and therefore cannot be
  used by other modules without tripping the boundary lint.
- **drizzle-kit** is a dev-time tool for *generating* forward SQL from
  schema diffs. Execution (apply/rollback/journal) is owned by the
  custom runner in ADR-0008 because drizzle-kit has no down-migration
  support.

## Alternatives considered

- **Prisma:** heavier runtime, generated client obscures SQL, schema DSL
  centralizes what we need decentralized (per-module ownership).
- **Kysely:** excellent typed SQL but no schema definition/migration
  generation; more hand-rolling than Drizzle for equal benefit.
- **Raw pg:** maximal control, but loses type inference from schema to
  query results, which rule "explicit typed SQL" is meant to protect.

## Consequences

- Module schema files are the single source of truth for column mapping;
  the audit writer maps the platform `AuditEvent` onto them explicitly.
- Drizzle's SQL-transparent API keeps EXPLAIN-ability; no hidden N+1
  abstractions.
- We track drizzle-team/drizzle-orm#4005 (native down migrations); if it
  lands, ADR-0008 is revisited.
