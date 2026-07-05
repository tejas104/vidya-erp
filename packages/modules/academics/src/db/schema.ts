import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * INTERNAL to the academics module (not exported from index.ts). All
 * tables carry the "acd_" prefix (Constitution rule 2; CI-checked).
 *
 * section_id / class_id / subject_id / student_id / college_id /
 * department_id are OPAQUE cross-module references to the people module —
 * deliberately no foreign keys (rule 2). They are validated against the
 * PeopleDirectory at write time and DENORMALIZED here so every record
 * carries its own org position for scope checks (ADR-0017); the org tree
 * has no move operation, so stored paths cannot go stale.
 */

export const acdAttendanceSessions = pgTable(
  "acd_attendance_sessions",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id").notNull(),
    heldOn: date("held_on", { mode: "string" }).notNull(),
    /** Supports multiple sessions per day ("day", "morning", "period-3"…). */
    slot: text("slot").notNull().default("day"),
    academicYear: text("academic_year").notNull(),
    takenBy: text("taken_by").notNull(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("acd_sessions_unique_idx").on(table.sectionId, table.heldOn, table.slot),
    index("acd_sessions_section_idx").on(table.sectionId, table.heldOn),
    index("acd_sessions_date_idx").on(table.heldOn),
  ],
);

export const acdAttendanceEntries = pgTable(
  "acd_attendance_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => acdAttendanceSessions.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("acd_entries_unique_idx").on(table.sessionId, table.studentId),
    index("acd_entries_student_idx").on(table.studentId),
  ],
);

export const acdAssessments = pgTable(
  "acd_assessments",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    subjectId: text("subject_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    academicYear: text("academic_year").notNull(),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull(),
    heldOn: date("held_on", { mode: "string" }),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("acd_assessments_unique_idx").on(
      table.classId,
      table.subjectId,
      table.academicYear,
      table.name,
    ),
    index("acd_assessments_class_idx").on(table.classId),
  ],
);

export const acdMarks = pgTable(
  "acd_marks",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => acdAssessments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull(),
    score: numeric("score", { precision: 6, scale: 2 }).notNull(),
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("acd_marks_unique_idx").on(table.assessmentId, table.studentId),
    index("acd_marks_student_idx").on(table.studentId),
  ],
);

export type AcdSessionRow = typeof acdAttendanceSessions.$inferSelect;
export type AcdEntryRow = typeof acdAttendanceEntries.$inferSelect;
export type AcdAssessmentRow = typeof acdAssessments.$inferSelect;
export type AcdMarkRow = typeof acdMarks.$inferSelect;
