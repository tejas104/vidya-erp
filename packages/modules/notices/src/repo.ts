import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { ntcNotices, type NoticeRow } from "./db/schema";

export interface NewNotice {
  readonly collegeId: string;
  readonly audience: string;
  readonly title: string;
  readonly body: string;
  readonly publishAt: Date;
  readonly expiresAt: Date | null;
  readonly createdBy: string;
}

export interface NoticesRepo {
  create(input: NewNotice): Promise<NoticeRow>;
  get(id: string): Promise<NoticeRow | null>;
  /** Every notice of a college (manage view), newest publish first. */
  listForCollege(collegeId: string): Promise<NoticeRow[]>;
  /** Live at `now`: published and not expired, newest first. */
  listLive(collegeId: string, now: Date): Promise<NoticeRow[]>;
  delete(id: string): Promise<boolean>;
}

export function createNoticesRepo(db: Db): NoticesRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(ntcNotices)
        .values({
          id: `ntc_${randomUUID()}`,
          collegeId: input.collegeId,
          audience: input.audience,
          title: input.title,
          body: input.body,
          publishAt: input.publishAt,
          expiresAt: input.expiresAt,
          createdBy: input.createdBy,
        })
        .returning();
      return rows[0]!;
    },

    async get(id) {
      const rows = await db.select().from(ntcNotices).where(eq(ntcNotices.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listForCollege(collegeId) {
      return db
        .select()
        .from(ntcNotices)
        .where(eq(ntcNotices.collegeId, collegeId))
        .orderBy(desc(ntcNotices.publishAt));
    },

    async listLive(collegeId, now) {
      return db
        .select()
        .from(ntcNotices)
        .where(
          and(
            eq(ntcNotices.collegeId, collegeId),
            lte(ntcNotices.publishAt, now),
            or(isNull(ntcNotices.expiresAt), gt(ntcNotices.expiresAt, now)),
          ),
        )
        .orderBy(desc(ntcNotices.publishAt));
    },

    async delete(id) {
      const rows = await db.delete(ntcNotices).where(eq(ntcNotices.id, id)).returning({ id: ntcNotices.id });
      return rows.length > 0;
    },
  };
}
