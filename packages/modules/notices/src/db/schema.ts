import { date, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** ntc_: the noticeboard AND the academic calendar. One row per notice;
 * visibility is derived at read time from audience × caller org paths. A row
 * with an event_date also appears on the calendar; kind colours it. */

export const ntcNotices = pgTable("ntc_notices", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  /** college | staff | students | department:<id> | class:<id> */
  audience: text("audience").notNull(),
  /** notice | holiday | exam | event — colours the calendar entry. */
  kind: text("kind").notNull().default("notice"),
  /** ISO date; a row with one appears on the academic calendar. */
  eventDate: date("event_date", { mode: "string" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  publishAt: timestamp("publish_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type NoticeRow = typeof ntcNotices.$inferSelect;
