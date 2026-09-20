import type { AuditEvent } from "./types";

/**
 * Proof that an audit event was written inside the caller's own database
 * transaction (ADR-0026). It is issued only by a TransactionalAuditLogger
 * implementation, immediately after its insert succeeded on the caller's
 * transaction handle, and is recognised by identity: a structurally similar
 * object built from client input, JSON or a copy is NOT a receipt.
 *
 * A receipt is only meaningful if the handler returns it after its
 * transaction committed. Handlers therefore obtain it inside the transaction
 * callback and return it from the callback — a rollback throws, so no
 * receipt ever escapes for a rolled-back write.
 */
export interface DurableAuditReceipt {
  readonly module: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly requestId: string | null;
}

const issued = new WeakSet<object>();

/**
 * For TransactionalAuditLogger implementations ONLY, and only after the
 * insert on the caller's transaction has resolved. Module code must never
 * call this directly — that would forge a proof it did not earn.
 */
export function issueDurableAuditReceipt(event: AuditEvent): DurableAuditReceipt {
  const receipt: DurableAuditReceipt = Object.freeze({
    module: event.module,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    requestId: event.requestId,
  });
  issued.add(receipt);
  return receipt;
}

export function isDurableAuditReceipt(value: unknown): value is DurableAuditReceipt {
  return typeof value === "object" && value !== null && issued.has(value);
}
