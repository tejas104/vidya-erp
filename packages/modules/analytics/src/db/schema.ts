import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * INTERNAL to the analytics module (not exported from index.ts). All
 * tables carry the "anl_" prefix (Constitution rule 2; CI-checked).
 *
 * These are PRECOMPUTED rollups the module owns — rebuilt nightly from #4
 * via its public read model, never from #4's tables. Every row carries the
 * org position of the node it summarizes, so serving runs the
 * constituent-closure checks of ADR-0018 against the row itself.
 * Storage is not disclosure: the nightly job computes everything; the
 * serving layer decides who sees what.
 */

export const anlAttendanceRollups = pgTable(
  "anl_attendance_rollups",
  {
    id: text("id").primaryKey(),
    scopeLevel: text("scope_level").notNull(),
    /** The summarized unit's own id (section/class/department/college id). */
    nodeId: text("node_id").notNull(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"),
    classId: text("class_id"),
    sectionId: text("section_id"),
    academicYear: text("academic_year").notNull(),
    /** "YTD" or a month bucket "YYYY-MM". */
    period: text("period").notNull(),
    sessions: integer("sessions").notNull(),
    present: integer("present").notNull(),
    absent: integer("absent").notNull(),
    late: integer("late").notNull(),
    excused: integer("excused").notNull(),
    distinctStudents: integer("distinct_students").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anl_att_rollups_unique_idx").on(table.nodeId, table.academicYear, table.period),
    index("anl_att_rollups_year_idx").on(table.academicYear),
  ],
);

export const anlMarksRollups = pgTable(
  "anl_marks_rollups",
  {
    id: text("id").primaryKey(),
    scopeLevel: text("scope_level").notNull(),
    nodeId: text("node_id").notNull(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"),
    classId: text("class_id"),
    academicYear: text("academic_year").notNull(),
    period: text("period").notNull(),
    /** Null = cross-subject aggregate; then `subjects` lists every constituent. */
    subjectId: text("subject_id"),
    /** Constituent subject ids of a cross-subject row (closure check input). */
    subjects: jsonb("subjects").notNull().default([]),
    avgPct: numeric("avg_pct", { precision: 5, scale: 2 }).notNull(),
    nMarks: integer("n_marks").notNull(),
    distinctStudents: integer("distinct_students").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anl_marks_rollups_unique_idx").on(
      table.nodeId,
      table.academicYear,
      table.period,
      table.subjectId,
    ),
    index("anl_marks_rollups_year_idx").on(table.academicYear),
  ],
);

export const anlStudentFlags = pgTable(
  "anl_student_flags",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    academicYear: text("academic_year").notNull(),
    /** Position at compute time (live enrollment; college-level if none). */
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"),
    classId: text("class_id"),
    sectionId: text("section_id"),
    attendancePct: numeric("attendance_pct", { precision: 5, scale: 2 }),
    overallPct: numeric("overall_pct", { precision: 5, scale: 2 }),
    /** { [subjectId]: avgPct } */
    subjectPcts: jsonb("subject_pcts").notNull().default({}),
    /** ["low-attendance" | "low-marks"] */
    reasons: jsonb("reasons").notNull().default([]),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("anl_flags_unique_idx").on(table.studentId, table.academicYear),
    index("anl_flags_class_idx").on(table.classId, table.academicYear),
    index("anl_flags_year_idx").on(table.academicYear),
  ],
);

export type AnlAttendanceRollupRow = typeof anlAttendanceRollups.$inferSelect;
export type AnlMarksRollupRow = typeof anlMarksRollups.$inferSelect;
export type AnlStudentFlagRow = typeof anlStudentFlags.$inferSelect;
