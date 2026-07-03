import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * INTERNAL to the system module (not exported from index.ts). Other modules
 * write audit events through the SystemService.audit interface, never
 * against this table (Constitution rules 2–3).
 *
 * All system-module tables carry the "sys_" prefix; scripts/check-table-ownership.ts
 * enforces the convention in CI.
 */
export const sysAuditLog = pgTable(
  "sys_audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    requestId: text("request_id"),
    details: jsonb("details").notNull().default({}),
  },
  (table) => [
    index("sys_audit_log_occurred_at_idx").on(table.occurredAt),
    index("sys_audit_log_action_idx").on(table.action),
  ],
);

export type SysAuditLogRow = typeof sysAuditLog.$inferSelect;
