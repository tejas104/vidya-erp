# ADR-0026: Transaction-aware audit for financial mutations

- **Status:** Accepted
- **Date:** 2026-09-21
- **Extends:** Constitution rule 7 (audit is fail-closed), ADR-0025 (tenant-scoped audit log)

## Context

`defineRoute` runs the handler, and only afterwards writes the audit row through
`AuditLogger.record`, on a separate connection. For a money mutation that
order is unsafe: the handler's transaction has already committed, so a failing
audit sink returns 500 while the payment, its receipt number and the invoice
status stay committed with no audit row (finding F5 in
`docs/audits/school-fee-correctness.md`). Payment idempotency stops a *retry*
from charging twice, but if nobody retries the audit row is simply lost.

## Decision

The mutation and its audit row are written in **one database transaction**,
owned by the module that performs the mutation.

1. **Platform seam.** `TransactionalAuditLogger extends AuditLogger` adds
   `recordInTransaction(tx, event): Promise<DurableAuditReceipt>`. The
   implementation (the system module's `SystemAuditLogger`, exposed as
   `SystemService.audit`) inserts into `sys_audit_log` on the **caller's
   transaction handle**, so fees never imports or names a system table
   (ownership rules unchanged). A rejected insert propagates and rolls back the
   caller's transaction.
2. **Typed proof, not a flag.** The implementation returns a
   `DurableAuditReceipt` issued by `issueDurableAuditReceipt`. Receipts are
   frozen objects recognised **by identity** (a module-private `WeakSet`), so a
   structurally identical object, a copy, or anything derived from request or
   JSON input is not a receipt.
3. **Route contract.** A handler may set
   `RouteResult.audit.persisted` to one of:
   - `{ kind: "in-transaction", receipt }` — the handler's transaction wrote the
     audit row;
   - `{ kind: "idempotent-replay", resourceId }` — the request performed no
     mutation because it replayed one already committed (with its own audit row)
     under a matching idempotency key.
4. **`defineRoute` verifies, never trusts.** For `in-transaction` it skips its
   own write only if `isDurableAuditReceipt(receipt)` **and** the receipt's
   module, action, resource type and request id equal the route's declared audit
   spec and the request id `defineRoute` resolved. Any mismatch logs an error and
   falls back to the ordinary fail-closed post-handler write: a recoverable
   duplicate is preferred over a missing audit row.
5. **No behaviour change by default.** A result without `persisted` (every
   module that has not adopted this) is audited exactly as before.

## Responsibilities

| Party | Responsibility |
| --- | --- |
| Module repo | Open the transaction, do the mutation, call `recordInTransaction(tx, event)` as the **last** step, return the receipt out of the transaction callback. The event's `org` comes from the row locked in the transaction, not from the request. |
| Module handler | Attribute the event (`actorType`/`actorId` from the authenticated principal, `requestId` from `ctx.requestId`); return `persisted`. Never derive any of it from the body. |
| `defineRoute` | Verify the receipt against the RouteSpec and request id; otherwise write the audit row itself. |
| Route spec | Share the action/resource-type constants with the repo (`FEES_AUDIT`) so the two cannot drift. |

## Duplicate-audit prevention

- New mutation: one row, written in the transaction; `defineRoute` skips.
- Idempotent replay: no new mutation, so no new "recorded" event; the handler
  returns `idempotent-replay` and `defineRoute` skips. The original event stays
  the single record.
- Verification mismatch: `defineRoute` writes one ordinary row. This can only
  duplicate when the handler was wrong; it can never lose the event.

## Adopting it in another module

1. Accept `TransactionalAuditLogger` (composition roots already pass
   `system.service.audit`, which now has that type — no wiring change).
2. In the repo transaction, call `recordInTransaction` last, using constants
   shared with the RouteSpec, and return the receipt.
3. In the handler, return `audit.persisted`.
4. Add a real-database test that makes the audit write fail and asserts the
   mutation rolled back, and one that asserts `defineRoute` wrote no second row.

## Consequences

- F5 is closed for fee payments and adjustments: both commit or neither does.
- A misbehaving `TransactionalAuditLogger` that issues receipts without writing
  would defeat the guarantee; only the system module's implementation may call
  `issueDurableAuditReceipt`, and the mutation tests (fault injection after the
  insert, and an audit write on a separate connection) exist to catch drift.
- `idempotent-replay` is a second skip path. It is narrow (only handlers that
  proved a matching stored idempotency key), server-side, and cannot be
  requested by a client, but it is not machine-verified. A payment committed by
  a pre-ADR build whose post-commit audit failed is not re-audited on replay.
- `sys_audit_log` and its append-only triggers are unchanged. **No migration.**
- Adopting modules pay one extra insert inside their transaction and must keep
  the audit insert last so the audit row does not extend lock hold time.
- Modules that have not adopted the mechanism keep the post-commit weakness
  described in Context until converted (see the audit report for the list).
