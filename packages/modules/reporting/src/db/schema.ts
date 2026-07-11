import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * INTERNAL to the reporting module (not exported from index.ts). One table,
 * "rpt_" prefix (Constitution rule 2; CI-checked). A report row is
 * bookkeeping for an artifact stored in MinIO; the artifact itself never
 * lives in Postgres. `requested_by` + `params` drive the scoped download
 * re-check (ADR-0020) — the object key is never the access control.
 */
export const rptReports = pgTable(
  "rpt_reports",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    /** The report's target (studentId / sectionId / classId / level+nodeId). */
    params: jsonb("params").notNull(),
    academicYear: text("academic_year").notNull(),
    /** Requester's scope snapshot at request time (roles + grants). The
     *  worker generates WITH this scope; the download handler re-checks the
     *  requester's CURRENT scope, so a later scope loss revokes access. */
    requesterPrincipal: jsonb("requester_principal").notNull(),
    status: text("status").notNull().default("pending"),
    objectKey: text("object_key"),
    rows: integer("rows").notNull().default(0),
    error: text("error"),
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("rpt_reports_requester_idx").on(table.requestedBy, table.createdAt)],
);

export type RptReportRow = typeof rptReports.$inferSelect;
