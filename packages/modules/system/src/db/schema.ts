import type { OrgPath } from "@vidya/platform";
import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
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
    org: jsonb("org").$type<OrgPath>(),
    details: jsonb("details").notNull().default({}),
  },
  (table) => [
    index("sys_audit_log_occurred_at_idx").on(table.occurredAt),
    index("sys_audit_log_action_idx").on(table.action),
  ],
);

export type SysAuditLogRow = typeof sysAuditLog.$inferSelect;

/**
 * Per-user keyed preference store (#11 task 12: onboarding checklist
 * dismissal / manual check-off state rides on this). Reads and writes are
 * ALWAYS scoped to the caller's own principal.id at the handler layer — this
 * table carries no other notion of ownership, so there is nothing to
 * scope-check beyond that (see api/handlers.ts).
 */
export const sysUserPreferences = pgTable(
  "sys_user_preferences",
  {
    userId: uuid("user_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export type SysUserPreferenceRow = typeof sysUserPreferences.$inferSelect;

/**
 * Single-row high-water mark of the latest date this installation has ever
 * observed (licence design spec, DECISION 2). `id` is fixed true by a CHECK
 * and is the primary key, so there can only ever be one row — the store
 * upserts on it rather than tracking a row id.
 */
export const sysClockWatermark = pgTable("sys_clock_watermark", {
  id: boolean("id").primaryKey().default(true),
  observedOn: date("observed_on", { mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SysClockWatermarkRow = typeof sysClockWatermark.$inferSelect;
