import { date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * INTERNAL to the school-terms module (not exported from index.ts). Every
 * table carries the "sch_" prefix (Constitution rule 2; CI-checked).
 *
 * `mode: "string"` on the date columns is load-bearing: node-postgres parses
 * a bare `date` into a JS Date at LOCAL midnight, which reads a day early
 * anywhere east of UTC. Calendar dates stay strings end to end, as the
 * production path does elsewhere (the academics module's date columns).
 */
export const schTerms = pgTable(
  "sch_terms",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    /** The ONE implicit department a school's tree hangs off (ADR-0023). */
    departmentId: text("department_id").notNull(),
    name: text("name").notNull(),
    academicYear: text("academic_year").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    /** open | closed — CHECK-constrained in SQL. */
    status: text("status").notNull().default("open"),
    /** The three below describe the MOST RECENT status change, not only a close. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    closedReason: text("closed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sch_terms_unique_idx").on(table.collegeId, table.academicYear, table.name),
    index("sch_terms_college_year_idx").on(table.collegeId, table.academicYear),
  ],
);

export type SchTermRow = typeof schTerms.$inferSelect;
