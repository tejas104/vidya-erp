import { date, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** fee_: heads, per-class structures, invoices, payments, adjustments.
 * Money is integer PAISE in every amount column — see ../money.ts. */

export const feeHeads = pgTable(
  "fee_heads",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("fee_heads_uq").on(table.collegeId, table.name)],
);
export type FeeHeadRow = typeof feeHeads.$inferSelect;

export const feeStructures = pgTable(
  "fee_structures",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    headId: text("head_id").notNull(),
    academicYear: text("academic_year").notNull(),
    amount: integer("amount").notNull(),
    dueOn: date("due_on").notNull(),
    installmentNo: integer("installment_no").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fee_structures_uq").on(table.classId, table.headId, table.academicYear, table.installmentNo),
  ],
);
export type FeeStructureRow = typeof feeStructures.$inferSelect;

export const feeInvoices = pgTable(
  "fee_invoices",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    sectionId: text("section_id").notNull(),
    studentId: text("student_id").notNull(),
    structureId: text("structure_id").notNull(),
    headId: text("head_id").notNull(),
    academicYear: text("academic_year").notNull(),
    amount: integer("amount").notNull(),
    dueOn: date("due_on").notNull(),
    status: text("status").$type<"pending" | "part" | "paid" | "waived">().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("fee_invoices_uq").on(table.studentId, table.structureId)],
);
export type FeeInvoiceRow = typeof feeInvoices.$inferSelect;

export const feeReceiptCounters = pgTable("fee_receipt_counters", {
  collegeId: text("college_id").primaryKey(),
  lastIssued: integer("last_issued").notNull().default(0),
});
export type FeeReceiptCounterRow = typeof feeReceiptCounters.$inferSelect;

export const feePayments = pgTable(
  "fee_payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    collegeId: text("college_id").notNull(),
    receiptNo: integer("receipt_no").notNull(),
    amount: integer("amount").notNull(),
    mode: text("mode").$type<"cash" | "upi" | "card" | "bank" | "gateway">().notNull(),
    ref: text("ref").notNull().default(""),
    receivedBy: text("received_by").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("fee_payments_receipt_uq").on(table.collegeId, table.receiptNo)],
);
export type FeePaymentRow = typeof feePayments.$inferSelect;

export const feeAdjustments = pgTable("fee_adjustments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  collegeId: text("college_id").notNull(),
  kind: text("kind").$type<"scholarship" | "fine" | "refund" | "waiver">().notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type FeeAdjustmentRow = typeof feeAdjustments.$inferSelect;

export const feeGenerationRuns = pgTable("fee_generation_runs", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  classId: text("class_id").notNull(),
  academicYear: text("academic_year").notNull(),
  status: text("status").$type<"pending" | "running" | "completed" | "failed">().notNull().default("pending"),
  invoicesCreated: integer("invoices_created").notNull().default(0),
  invoicesSkipped: integer("invoices_skipped").notNull().default(0),
  error: text("error"),
  requestedBy: text("requested_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export type FeeGenerationRunRow = typeof feeGenerationRuns.$inferSelect;
