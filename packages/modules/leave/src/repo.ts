import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { lvsRequests, type LeaveRequestRow } from "./db/schema";

export interface LeaveRepo {
  create(input: {
    collegeId: string;
    departmentId: string | null;
    teacherId: string;
    fromOn: string;
    toOn: string;
    kind: string;
    reason: string;
  }): Promise<LeaveRequestRow>;
  get(id: string): Promise<LeaveRequestRow | null>;
  listForTeacher(teacherId: string): Promise<LeaveRequestRow[]>;
  /** Pending requests in a college whose department is one of `departmentIds`,
   * OR (when `includeCollegeWide`) whose department is null. Newest first. */
  listPending(
    collegeId: string,
    departmentIds: string[],
    includeCollegeWide: boolean,
  ): Promise<LeaveRequestRow[]>;
  decide(input: {
    id: string;
    status: "approved" | "rejected";
    decidedBy: string;
    decisionNote: string | null;
  }): Promise<LeaveRequestRow>;
}

export function createLeaveRepo(db: Db): LeaveRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(lvsRequests)
        .values({ id: `lvr_${randomUUID()}`, ...input })
        .returning();
      return rows[0]!;
    },

    async get(id) {
      const rows = await db.select().from(lvsRequests).where(eq(lvsRequests.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listForTeacher(teacherId) {
      return db
        .select()
        .from(lvsRequests)
        .where(eq(lvsRequests.teacherId, teacherId))
        .orderBy(desc(lvsRequests.createdAt));
    },

    async listPending(collegeId, departmentIds, includeCollegeWide) {
      // Principal: every pending row in the college (no dept filter — this also
      // covers null-department rows). HOD: only their departments' pending rows.
      if (!includeCollegeWide && departmentIds.length === 0) return [];
      const base = [eq(lvsRequests.collegeId, collegeId), eq(lvsRequests.status, "pending")];
      const where = includeCollegeWide
        ? and(...base)
        : and(...base, inArray(lvsRequests.departmentId, departmentIds));
      return db.select().from(lvsRequests).where(where).orderBy(desc(lvsRequests.createdAt));
    },

    async decide(input) {
      const rows = await db
        .update(lvsRequests)
        .set({
          status: input.status,
          decidedBy: input.decidedBy,
          decisionNote: input.decisionNote,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lvsRequests.id, input.id))
        .returning();
      return rows[0]!;
    },
  };
}
