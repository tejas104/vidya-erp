import { date, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sylUnits = pgTable(
  "syl_units",
  {
    id: text("id").primaryKey(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id").notNull(),
    classId: text("class_id").notNull(),
    subjectId: text("subject_id").notNull(),
    teacherId: text("teacher_id").notNull(),
    academicYear: text("academic_year").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("syl_unit_title_uq").on(t.classId, t.subjectId, t.academicYear, t.title),
    index("syl_unit_class_idx").on(t.classId, t.academicYear),
  ],
);
export type SylUnitRow = typeof sylUnits.$inferSelect;

export const sylTopics = pgTable(
  "syl_topics",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    taughtOn: date("taught_on", { mode: "string" }),
    taughtBy: text("taught_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("syl_topic_unit_idx").on(t.unitId)],
);
export type SylTopicRow = typeof sylTopics.$inferSelect;
