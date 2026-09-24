import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { issueDurableAuditReceipt, type AuditEvent, type Db, type DurableAuditReceipt, type TransactionalAuditLogger } from "@vidya/platform";
import { sysAuditLog, type SysAuditLogRow } from "../db/schema";

export type AuditLogRecord = SysAuditLogRow;

/**
 * The real audit sink behind the platform AuditLogger seam: a Drizzle insert
 * into the append-only sys_audit_log table. Durable before resolve — the
 * insert has committed when record() returns.
 */
export class SystemAuditLogger implements TransactionalAuditLogger {
  constructor(private readonly db: Db) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(sysAuditLog).values(auditRow(event));
  }

  /**
   * ADR-0026: the same insert, but on the caller's transaction so the
   * mutation and its audit row commit or roll back together. A failure here
   * rejects and the caller's transaction rolls back (fail-closed).
   */
  async recordInTransaction(tx: Db, event: AuditEvent): Promise<DurableAuditReceipt> {
    await tx.insert(sysAuditLog).values(auditRow(event));
    return issueDurableAuditReceipt(event);
  }
}

function auditRow(event: AuditEvent) {
  return {
    org: event.org ?? null,
    module: event.module,
    action: event.action,
    actorType: event.actorType,
    actorId: event.actorId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    requestId: event.requestId,
    details: event.details,
  };
}

/** Filter before LIMIT so another institution cannot crowd out this page. */
export async function readScopedAuditEvents(db: Db, collegeIds: string[], action: string | undefined, limit: number): Promise<AuditLogRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError("invalid audit limit");
  if (collegeIds.length === 0) return [];
  return db.select().from(sysAuditLog).where(and(
    inArray(sql<string>`${sysAuditLog.org}->>'collegeId'`, collegeIds),
    action === undefined ? undefined : eq(sysAuditLog.action, action),
  )).orderBy(desc(sysAuditLog.id)).limit(limit);
}

/**
 * Read-side of the system service API, used operationally (and by the
 * integration suite) to verify audited actions. Newest first.
 */
export async function readRecentAuditEvents(db: Db, limit: number): Promise<AuditLogRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("limit must be an integer between 1 and 1000");
  }
  return db.select().from(sysAuditLog).orderBy(desc(sysAuditLog.id)).limit(limit);
}

/**
 * Recent events for one action, newest first — e.g. every attendance
 * correction college-wide, for a section-scoped corrections queue to
 * filter down from (Vidya #4's recent-corrections read rides on this).
 */
export async function readAuditEventsByAction(
  db: Db,
  action: string,
  limit: number,
): Promise<AuditLogRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("limit must be an integer between 1 and 1000");
  }
  return db
    .select()
    .from(sysAuditLog)
    .where(eq(sysAuditLog.action, action))
    .orderBy(desc(sysAuditLog.occurredAt))
    .limit(limit);
}

/**
 * The change history of one resource, newest first — e.g. every grade
 * change of a mark (Vidya #4's differential history rides on this).
 */
export async function readAuditEventsForResource(
  db: Db,
  resourceType: string,
  resourceId: string,
  limit: number,
  beforeId?: number,
): Promise<AuditLogRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("limit must be an integer between 1 and 1000");
  }
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) {
    throw new RangeError("beforeId must be a positive safe integer");
  }
  return db
    .select()
    .from(sysAuditLog)
    .where(and(
      eq(sysAuditLog.resourceType, resourceType),
      eq(sysAuditLog.resourceId, resourceId),
      beforeId === undefined ? undefined : lt(sysAuditLog.id, beforeId),
    ))
    .orderBy(desc(sysAuditLog.id))
    .limit(limit);
}
