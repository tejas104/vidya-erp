import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** exm_: the exam timetable. A series (Midterm · 2026-27 · Term 1) holds dated
 * slots; academic_year/term are denormalized onto slots so schedule reads
 * never join. Slots cascade with their series. */

export const exmSeries = pgTable(
  "exm_series",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    name: text("name").notNull(),
    academicYear: text("academic_year").notNull(),
    term: text("term").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("exm_series_name_uq").on(table.collegeId, table.name, table.academicYear)],
);
export type ExamSeriesRow = typeof exmSeries.$inferSelect;

export const exmSlots = pgTable(
  "exm_slots",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    seriesId: text("series_id")
      .notNull()
      .references(() => exmSeries.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").notNull(),
    academicYear: text("academic_year").notNull(),
    onDate: text("on_date").notNull(),
    starts: text("starts").notNull(),
    ends: text("ends").notNull(),
    room: text("room").notNull().default(""),
  },
  (table) => [uniqueIndex("exm_slots_paper_uq").on(table.seriesId, table.classId, table.subjectId)],
);
export type ExamSlotRow = typeof exmSlots.$inferSelect;
