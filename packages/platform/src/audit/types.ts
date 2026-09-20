/**
 * Audit-log write seam (Constitution rule 7).
 *
 * The interface lives in the platform so every module and the http pipeline
 * can record events; the storage lives in the system module's append-only
 * sys_audit_log table and is injected by each composition root.
 */

import type { OrgPath } from "../auth/types";
import type { Db } from "../db/client";
import type { DurableAuditReceipt } from "./durable-receipt";
export type ActorType = "user" | "service" | "system";

export interface AuditEvent {
  /** Resolved resource scope, supplied by trusted server code. Absent means operational-only. */
  readonly org?: OrgPath;
  /** Owning module of the action, e.g. "system". */
  readonly module: string;
  /** Dotted verb, e.g. "system.heartbeat". */
  readonly action: string;
  readonly actorType: ActorType;
  /** Principal id, or null for autonomous system activity. */
  readonly actorId: string | null;
  readonly resourceType: string;
  readonly resourceId: string | null;
  /** Correlation id of the originating request, when there is one. */
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditLogger {
  /**
   * Persists one audit event. Implementations MUST be durable before
   * resolving; callers treat a rejection as a failure of the audited action
   * (the http pipeline fails the request if the audit write fails).
   */
  record(event: AuditEvent): Promise<void>;
}

/**
 * An audit sink that can also write inside a caller-owned transaction
 * (ADR-0026). The mutation and its audit row then commit or roll back
 * together. `tx` is the transaction handle from `db.transaction(...)`; the
 * implementation MUST run its insert on it (never on its own connection) and
 * return the receipt only after that insert resolved. A rejection must
 * propagate so the caller's transaction rolls back (fail-closed).
 */
export interface TransactionalAuditLogger extends AuditLogger {
  recordInTransaction(tx: Db, event: AuditEvent): Promise<DurableAuditReceipt>;
}
