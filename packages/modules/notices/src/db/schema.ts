import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** ntc_: the noticeboard. One row per notice; visibility is derived at read
 * time from audience × caller org paths — nothing is fanned out per user. */

export const ntcNotices = pgTable("ntc_notices", {
  id: text("id").primaryKey(),
  collegeId: text("college_id").notNull(),
  /** college | staff | students | department:<id> | class:<id> */
  audience: text("audience").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  publishAt: timestamp("publish_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type NoticeRow = typeof ntcNotices.$inferSelect;
