import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * INTERNAL to the people module (not exported from index.ts). All tables
 * carry the "ppl_" prefix (Constitution rule 2; CI-checked). The org tree
 * here is THE canonical source of the opaque org identifiers that #2's
 * scope grants reference. `identity_user_id` on teachers is an opaque
 * cross-module reference to the identity module's user records —
 * deliberately NOT a foreign key.
 */

export const pplColleges = pgTable("ppl_colleges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ppl_colleges_code_idx").on(table.code)]);

export const pplDepartments = pgTable("ppl_departments", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull().references(() => pplColleges.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ppl_departments_code_idx").on(table.collegeId, table.code)]);

export const pplClasses = pgTable("ppl_classes", {
  id: text("id").primaryKey(),
  departmentId: text("department_id").notNull().references(() => pplDepartments.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ppl_classes_code_idx").on(table.departmentId, table.code)]);

export const pplSections = pgTable("ppl_sections", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => pplClasses.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ppl_sections_name_idx").on(table.classId, table.name)]);

export const pplSubjects = pgTable("ppl_subjects", {
  id: text("id").primaryKey(),
  departmentId: text("department_id").notNull().references(() => pplDepartments.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ppl_subjects_code_idx").on(table.departmentId, table.code)]);

export const pplStudents = pgTable("ppl_students", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull().references(() => pplColleges.id, { onDelete: "restrict" }),
  admissionNo: text("admission_no").notNull(),
  fullName: text("full_name").notNull(),
  status: text("status").notNull().default("active"),
  sourceImportId: text("source_import_id"),
  /** Opaque identity user id (W1 student-portal link) — no cross-module FK. */
  identityUserId: text("identity_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ppl_students_admission_idx").on(table.collegeId, table.admissionNo),
]);

export const pplTeachers = pgTable("ppl_teachers", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull().references(() => pplColleges.id, { onDelete: "restrict" }),
  staffNo: text("staff_no").notNull(),
  fullName: text("full_name").notNull(),
  status: text("status").notNull().default("active"),
  /** Opaque link to the identity module's user — NO foreign key (rule 2). */
  identityUserId: text("identity_user_id"),
  sourceImportId: text("source_import_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ppl_teachers_staff_idx").on(table.collegeId, table.staffNo),
  index("ppl_teachers_identity_idx").on(table.identityUserId),
]);

export const pplEnrollments = pgTable("ppl_enrollments", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => pplStudents.id, { onDelete: "cascade" }),
  sectionId: text("section_id").notNull().references(() => pplSections.id, { onDelete: "restrict" }),
  academicYear: text("academic_year").notNull(),
  status: text("status").notNull().default("enrolled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ppl_enrollments_section_idx").on(table.sectionId),
  index("ppl_enrollments_student_idx").on(table.studentId),
]);

export const pplTeacherAssignments = pgTable("ppl_teacher_assignments", {
  id: text("id").primaryKey(),
  teacherId: text("teacher_id").notNull().references(() => pplTeachers.id, { onDelete: "cascade" }),
  classId: text("class_id").notNull().references(() => pplClasses.id, { onDelete: "restrict" }),
  /** Required for kind=subject_teacher, forbidden for kind=class_teacher (CHECK). */
  subjectId: text("subject_id").references(() => pplSubjects.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  academicYear: text("academic_year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ppl_assignments_teacher_idx").on(table.teacherId),
  index("ppl_assignments_class_idx").on(table.classId),
]);

export const pplImports = pgTable("ppl_imports", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  collegeId: text("college_id").notNull().references(() => pplColleges.id, { onDelete: "restrict" }),
  academicYear: text("academic_year"),
  status: text("status").notNull().default("pending"),
  dryRun: boolean("dry_run").notNull().default(false),
  objectKey: text("object_key").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  okRows: integer("ok_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  /** First N row errors, [{row, message}] — capped by the import service. */
  errors: jsonb("errors").notNull().default([]),
  requestedBy: text("requested_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type PplCollegeRow = typeof pplColleges.$inferSelect;
export type PplDepartmentRow = typeof pplDepartments.$inferSelect;
export type PplClassRow = typeof pplClasses.$inferSelect;
export type PplSectionRow = typeof pplSections.$inferSelect;
export type PplSubjectRow = typeof pplSubjects.$inferSelect;
export type PplStudentRow = typeof pplStudents.$inferSelect;
export type PplTeacherRow = typeof pplTeachers.$inferSelect;
export type PplEnrollmentRow = typeof pplEnrollments.$inferSelect;
export type PplAssignmentRow = typeof pplTeacherAssignments.$inferSelect;
export type PplImportRow = typeof pplImports.$inferSelect;
