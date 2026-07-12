import { integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const cwkAssignments = pgTable(
  "cwk_assignments",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    subjectId: text("subject_id").notNull(),
    teacherId: text("teacher_id").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    dueOn: text("due_on").notNull(),
    maxScore: numeric("max_score", { precision: 7, scale: 2 }),
    academicYear: text("academic_year").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cwk_assignment_title_uq").on(t.classId, t.subjectId, t.academicYear, t.title)],
);
export type CwkAssignmentRow = typeof cwkAssignments.$inferSelect;

export const cwkSubmissions = pgTable(
  "cwk_submissions",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull(),
    studentId: text("student_id").notNull(),
    body: text("body").notNull().default(""),
    objectKey: text("object_key"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    score: numeric("score", { precision: 7, scale: 2 }),
    feedback: text("feedback"),
    evaluatedBy: text("evaluated_by"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("cwk_submission_uq").on(t.assignmentId, t.studentId)],
);
export type CwkSubmissionRow = typeof cwkSubmissions.$inferSelect;

export const cwkMaterials = pgTable("cwk_materials", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  departmentId: text("department_id").notNull(),
  classId: text("class_id").notNull(),
  subjectId: text("subject_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  title: text("title").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  academicYear: text("academic_year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CwkMaterialRow = typeof cwkMaterials.$inferSelect;
