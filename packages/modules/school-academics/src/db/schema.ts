import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Band } from "@vidya/module-results";

/**
 * INTERNAL to the school-academics module (not exported from index.ts). Every
 * table carries the "sca_" prefix (Constitution rule 2; CI-checked).
 *
 * `mode: "string"` on the date columns is load-bearing: node-postgres parses
 * a bare `date` into a JS Date at LOCAL midnight, which reads a day early
 * anywhere east of UTC. Calendar dates stay strings end to end, as the
 * production path does elsewhere (the academics module's date columns).
 */
export const schTerms = pgTable(
  "sca_terms",
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
    scaleId: text("scale_id"),
    scaleName: text("scale_name"),
    gradeBands: jsonb("grade_bands").$type<Band[]>(),
    /** The three below describe the MOST RECENT status change, not only a close. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    closedReason: text("closed_reason"),
    /** Null on old closed terms and while open; set only by release or new close. */
    marksReleasedAt: timestamp("marks_released_at", { withTimezone: true }),
    /** Explicit dates; null means the school has not configured a calendar. */
    instructionalDays: jsonb("instructional_days").$type<string[]>(),
    shortfallThreshold: numeric("shortfall_threshold", { precision: 5, scale: 2 }),
    calendarVersion: integer("calendar_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sca_terms_unique_idx").on(table.collegeId, table.academicYear, table.name),
    index("sca_terms_college_year_idx").on(table.collegeId, table.academicYear),
  ],
);

export type SchTermRow = typeof schTerms.$inferSelect;

export const assessmentTypes = pgTable("sca_assessment_types", {
  id: text("id").primaryKey(),
  termId: text("term_id").notNull().references(() => schTerms.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  weight: integer("weight").notNull(),
}, (table) => [index("sca_assessment_types_term_idx").on(table.termId)]);

export const assessments = pgTable("sca_assessments", {
  id: text("id").primaryKey(),
  termId: text("term_id").notNull().references(() => schTerms.id, { onDelete: "restrict" }),
  typeId: text("type_id").notNull().references(() => assessmentTypes.id, { onDelete: "restrict" }),
  collegeId: text("college_id").notNull(),
  departmentId: text("department_id").notNull(),
  classId: text("class_id").notNull(),
  subjectId: text("subject_id").notNull(),
  name: text("name").notNull(),
  academicYear: text("academic_year").notNull(),
  maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull(),
  heldOn: date("held_on", { mode: "string" }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sca_assessments_name_idx").on(table.termId, table.classId, table.subjectId, table.name),
  index("sca_assessments_class_year_idx").on(table.classId, table.academicYear),
]);

export const marks = pgTable("sca_marks", {
  id: text("id").primaryKey(),
  assessmentId: text("assessment_id").notNull().references(() => assessments.id, { onDelete: "restrict" }),
  studentId: text("student_id").notNull(),
  score: numeric("score", { precision: 6, scale: 2 }).notNull(),
  percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
  grade: text("grade").notNull(),
  points: numeric("points", { precision: 5, scale: 2 }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("sca_marks_assessment_student_idx").on(table.assessmentId, table.studentId), index("sca_marks_student_idx").on(table.studentId)]);

export type SchoolAssessmentRow = typeof assessments.$inferSelect;
export type SchoolMarkRow = typeof marks.$inferSelect;
