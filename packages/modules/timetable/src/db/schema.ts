import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** ttb_: fixed-period weekly schedules; clash uniqueness lives in the DB. */

export const ttbPeriods = pgTable(
  "ttb_periods",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    periodNo: integer("period_no").notNull(),
    starts: text("starts").notNull(),
    ends: text("ends").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ttb_periods_uq").on(table.collegeId, table.periodNo)],
);
export type TtbPeriodRow = typeof ttbPeriods.$inferSelect;

export const ttbEntries = pgTable("ttb_entries", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  departmentId: text("department_id").notNull(),
  classId: text("class_id").notNull(),
  sectionId: text("section_id").notNull(),
  subjectId: text("subject_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  room: text("room").notNull().default(""),
  dayOfWeek: integer("day_of_week").notNull(),
  periodNo: integer("period_no").notNull(),
  academicYear: text("academic_year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TtbEntryRow = typeof ttbEntries.$inferSelect;
