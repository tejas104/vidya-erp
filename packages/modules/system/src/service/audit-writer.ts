import { desc } from "drizzle-orm";
import type { AuditEvent, AuditLogger, Db } from "@vidya/platform";
import { sysAuditLog, type SysAuditLogRow } from "../db/schema";

export type AuditLogRecord = SysAuditLogRow;

/**
 * The real audit sink behind the platform AuditLogger seam: a Drizzle insert
 * into the append-only sys_audit_log table. Durable before resolve — the
 * insert has committed when record() returns.
 */
export class SystemAuditLogger implements AuditLogger {
  constructor(private readonly db: Db) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db.insert(sysAuditLog).values({
      module: event.module,
      action: event.action,
      actorType: event.actorType,
      actorId: event.actorId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      details: event.details,
    });
  }
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
