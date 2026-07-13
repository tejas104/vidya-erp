import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Band } from "../gpa";

/** res_: the marksheet. Results are computed live from marks × credits × scale;
 * only the scale, the credits and the publication gate are stored. */

export const resGradeScales = pgTable(
  "res_grade_scales",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    name: text("name").notNull(),
    /** [{minPct, grade, points}] — validated by the contract (tiles 0–100). */
    bands: jsonb("bands").$type<Band[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("res_scales_name_uq").on(table.collegeId, table.name)],
);
export type GradeScaleRow = typeof resGradeScales.$inferSelect;

export const resSubjectCredits = pgTable(
  "res_subject_credits",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    subjectId: text("subject_id").notNull(),
    academicYear: text("academic_year").notNull(),
    credits: integer("credits").notNull(),
  },
  (table) => [uniqueIndex("res_credits_uq").on(table.classId, table.subjectId, table.academicYear)],
);
export type SubjectCreditRow = typeof resSubjectCredits.$inferSelect;

export const resPublications = pgTable(
  "res_publications",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    academicYear: text("academic_year").notNull(),
    term: text("term").notNull(),
    scaleId: text("scale_id")
      .notNull()
      .references(() => resGradeScales.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: text("published_by").notNull(),
  },
  (table) => [uniqueIndex("res_publications_uq").on(table.classId, table.academicYear, table.term)],
);
export type PublicationRow = typeof resPublications.$inferSelect;
