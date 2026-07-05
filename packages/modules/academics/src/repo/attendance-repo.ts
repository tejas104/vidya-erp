import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  acdAttendanceEntries,
  acdAttendanceSessions,
  type AcdEntryRow,
  type AcdSessionRow,
} from "../db/schema";

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export class DuplicateSessionError extends Error {
  constructor() {
    super("a session already exists for this section, date and slot");
    this.name = "DuplicateSessionError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

export interface NewSession {
  readonly sectionId: string;
  readonly heldOn: string;
  readonly slot: string;
  readonly academicYear: string;
  readonly takenBy: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly entries: readonly { studentId: string; status: AttendanceStatus }[];
}

export interface AttendanceRepo {
  /** Session + all entries atomically. */
  createSession(input: NewSession): Promise<AcdSessionRow>;
  getSession(id: string): Promise<AcdSessionRow | null>;
  entriesForSession(sessionId: string): Promise<AcdEntryRow[]>;
  listSessions(
    sectionId: string,
    range: { from?: string; to?: string; limit: number },
  ): Promise<{ session: AcdSessionRow; entries: AcdEntryRow[] }[]>;
  /** Returns the previous status, or null when no such entry exists. */
  updateEntryStatus(
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
  ): Promise<{ before: AttendanceStatus } | null>;
  sessionsForStudent(
    studentId: string,
    academicYear?: string,
  ): Promise<{ session: AcdSessionRow; entry: AcdEntryRow }[]>;
  /** Which of these sections have any session on the date. */
  sectionsWithSessionOn(date: string, sectionIds: readonly string[]): Promise<Set<string>>;
}

export function createAttendanceRepo(db: Db): AttendanceRepo {
  return {
    async createSession(input) {
      const sessionId = `ses_${randomUUID()}`;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(acdAttendanceSessions).values({
            id: sessionId,
            sectionId: input.sectionId,
            heldOn: input.heldOn,
            slot: input.slot,
            academicYear: input.academicYear,
            takenBy: input.takenBy,
            collegeId: input.collegeId,
            departmentId: input.departmentId,
            classId: input.classId,
          });
          await tx.insert(acdAttendanceEntries).values(
            input.entries.map((entry) => ({
              id: `ate_${randomUUID()}`,
              sessionId,
              studentId: entry.studentId,
              status: entry.status,
            })),
          );
        });
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicateSessionError();
        }
        throw error;
      }
      const created = await this.getSession(sessionId);
      if (created === null) {
        throw new Error("session vanished immediately after creation");
      }
      return created;
    },

    async getSession(id) {
      const rows = await db
        .select()
        .from(acdAttendanceSessions)
        .where(eq(acdAttendanceSessions.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async entriesForSession(sessionId) {
      return db
        .select()
        .from(acdAttendanceEntries)
        .where(eq(acdAttendanceEntries.sessionId, sessionId));
    },

    async listSessions(sectionId, range) {
      const conditions = [eq(acdAttendanceSessions.sectionId, sectionId)];
      if (range.from !== undefined) {
        conditions.push(gte(acdAttendanceSessions.heldOn, range.from));
      }
      if (range.to !== undefined) {
        conditions.push(lte(acdAttendanceSessions.heldOn, range.to));
      }
      const sessions = await db
        .select()
        .from(acdAttendanceSessions)
        .where(and(...conditions))
        .orderBy(desc(acdAttendanceSessions.heldOn), desc(acdAttendanceSessions.slot))
        .limit(range.limit);
      const result = [];
      for (const session of sessions) {
        result.push({ session, entries: await this.entriesForSession(session.id) });
      }
      return result;
    },

    async updateEntryStatus(sessionId, studentId, status) {
      const existing = await db
        .select()
        .from(acdAttendanceEntries)
        .where(
          and(
            eq(acdAttendanceEntries.sessionId, sessionId),
            eq(acdAttendanceEntries.studentId, studentId),
          ),
        )
        .limit(1);
      const entry = existing[0];
      if (entry === undefined) {
        return null;
      }
      await db
        .update(acdAttendanceEntries)
        .set({ status, updatedAt: new Date() })
        .where(eq(acdAttendanceEntries.id, entry.id));
      return { before: entry.status as AttendanceStatus };
    },

    async sessionsForStudent(studentId, academicYear) {
      const conditions = [eq(acdAttendanceEntries.studentId, studentId)];
      const rows = await db
        .select({ session: acdAttendanceSessions, entry: acdAttendanceEntries })
        .from(acdAttendanceEntries)
        .innerJoin(
          acdAttendanceSessions,
          eq(acdAttendanceEntries.sessionId, acdAttendanceSessions.id),
        )
        .where(
          academicYear === undefined
            ? and(...conditions)
            : and(...conditions, eq(acdAttendanceSessions.academicYear, academicYear)),
        )
        .orderBy(desc(acdAttendanceSessions.heldOn));
      return rows;
    },

    async sectionsWithSessionOn(date, sectionIds) {
      const found = new Set<string>();
      for (let index = 0; index < sectionIds.length; index += 1000) {
        const chunk = sectionIds.slice(index, index + 1000);
        const rows = await db
          .selectDistinct({ sectionId: acdAttendanceSessions.sectionId })
          .from(acdAttendanceSessions)
          .where(
            and(
              eq(acdAttendanceSessions.heldOn, date),
              inArray(acdAttendanceSessions.sectionId, chunk),
            ),
          );
        for (const row of rows) {
          found.add(row.sectionId);
        }
      }
      return found;
    },
  };
}
