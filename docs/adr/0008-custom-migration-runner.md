# ADR-0008: Custom journal-aware migration runner (forward + rollback)

- **Status:** Accepted — ⚠ **FLAGGED FOR CAREFUL HUMAN REVIEW** (approved
  amendment 2: this component replaces vendor tooling for a
  data-destructive concern and must be reviewed line by line)
- **Date:** 2026-07-02
- **Code:** `packages/platform/src/db/migrator.ts`, CLI `scripts/migrate.ts`

## Context

The Definition of Done requires forward **and rollback** migrations.
As of this writing drizzle-kit cannot roll back:

- [drizzle-orm discussion #1339](https://github.com/drizzle-team/drizzle-orm/discussions/1339)
  and [issue #4005](https://github.com/drizzle-team/drizzle-orm/issues/4005)
  — down migrations are requested, acknowledged, not shipped.
- The [official docs](https://orm.drizzle.team/docs/kit-overview) recommend
  manual reverse SQL or backup restore.
- Community wrappers (e.g. `@aegon_targaryen/drizzle-migrations`) are
  single-maintainer/low-adoption — unacceptable for a component that can
  destroy data.

## Decision

Keep drizzle-kit for **generating** forward SQL; own **execution** in a
~250-line runner with these properties:

- **Pairing is mandatory:** `NNNN_name.sql` without `NNNN_name.down.sql`
  (or an orphan down file) fails discovery — rollback coverage cannot rot.
- **Journal:** `platform_migrations` (module, name, applied_at, unique) —
  the single platform-owned table, exempted from module ownership by this
  ADR.
- **Locking:** `pg_advisory_lock` serializes concurrent runners (replicas
  racing at deploy).
- **Transactionality:** each migration + its journal write commits in one
  transaction; failure rolls back both.
- **Drift detection:** journaled-but-missing-on-disk and
  out-of-order-application both abort with explicit errors.
- **Ordering:** per module in registry order, lexical within a module;
  rollback strictly follows reverse journal order.

## Verification available to the reviewer

- Unit: discovery/pairing/planning (`migrator.test.ts`).
- Integration: up → down → up on real Postgres, idempotence, journal
  contents, concurrent `migrateUp`, missing-down-file refusal
  (`tests/integration/migrations.int.test.ts`).
- CI runs `db:migrate && db:rollback && db:migrate` as an explicit step.

## Specific review questions for the human gate

1. Multi-statement SQL executes via pg's simple-query protocol — acceptable
   vs. per-statement splitting?
2. Advisory-lock key is a constant (727271) — collision policy fine?
3. Rollback of `0000_audit_log` destroys audit history by design; the
   runbook mandates a backup first — is a runner-level guard (refuse
   without `--force` on tables matching audit patterns) wanted in #2?

## Consequences

- We own correctness of the execution path (mitigated by the test matrix
  above and this review gate).
- Revisit when drizzle-orm#4005 ships native down migrations.
