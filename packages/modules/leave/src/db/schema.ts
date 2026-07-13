import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** lvs_: the staff-leave register. A request is raised by a teacher and decided
 * by their HOD (department_id) or the principal (college-wide). department_id is
 * null for teachers with no assignments — those go straight to the principal. */
export const lvsRequests = pgTable(
  "lvs_requests",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"), // nullable = college-level
    teacherId: text("teacher_id").notNull(),
    fromOn: text("from_on").notNull(),
    toOn: text("to_on").notNull(),
    kind: text("kind").notNull(), // casual | sick | duty
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lvs_requests_teacher_idx").on(table.teacherId),
    index("lvs_requests_college_status_idx").on(table.collegeId, table.status),
    index("lvs_requests_dept_status_idx").on(table.departmentId, table.status),
  ],
);
export type LeaveRequestRow = typeof lvsRequests.$inferSelect;
