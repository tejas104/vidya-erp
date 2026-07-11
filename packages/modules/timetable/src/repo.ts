import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { ttbEntries, ttbPeriods, type TtbEntryRow, type TtbPeriodRow } from "./db/schema";

/** Which resource a clash constraint protects — used for friendly 409s. */
export type ClashResource = "section" | "teacher" | "room";

export class SlotClashError extends Error {
  constructor(readonly resource: ClashResource) {
    super(`${resource} is already booked in that period`);
    this.name = "SlotClashError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}
function pgConstraint(error: unknown): string | undefined {
  const direct = (error as { constraint?: string }).constraint;
  if (direct !== undefined) return direct;
  return (error as { cause?: { constraint?: string } }).cause?.constraint;
}

export interface NewEntry {
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly sectionId: string;
  readonly subjectId: string;
  readonly teacherId: string;
  readonly room: string;
  readonly dayOfWeek: number;
  readonly periodNo: number;
  readonly academicYear: string;
}

export interface TimetableRepo {
  periodsFor(collegeId: string): Promise<TtbPeriodRow[]>;
  /** Replace-all template write (transactional). */
  setPeriods(collegeId: string, periods: { periodNo: number; starts: string; ends: string }[]): Promise<void>;
  /** Throws SlotClashError naming the busy resource on 23505. */
  createEntry(entry: NewEntry): Promise<TtbEntryRow>;
  getEntry(id: string): Promise<TtbEntryRow | null>;
  deleteEntry(id: string): Promise<boolean>;
  entriesForSection(sectionId: string, academicYear: string): Promise<TtbEntryRow[]>;
  entriesForTeacher(teacherId: string, academicYear: string): Promise<TtbEntryRow[]>;
  entriesForTeacherDay(teacherId: string, academicYear: string, dayOfWeek: number): Promise<TtbEntryRow[]>;
}

export function createTimetableRepo(db: Db): TimetableRepo {
  return {
    async periodsFor(collegeId) {
      return db.select().from(ttbPeriods).where(eq(ttbPeriods.collegeId, collegeId)).orderBy(asc(ttbPeriods.periodNo));
    },

    async setPeriods(collegeId, periods) {
      await db.transaction(async (tx) => {
        await tx.delete(ttbPeriods).where(eq(ttbPeriods.collegeId, collegeId));
        if (periods.length > 0) {
          await tx.insert(ttbPeriods).values(
            periods.map((period) => ({
              id: `ttp_${randomUUID()}`,
              collegeId,
              periodNo: period.periodNo,
              starts: period.starts,
              ends: period.ends,
            })),
          );
        }
      });
    },

    async createEntry(entry) {
      try {
        const rows = await db
          .insert(ttbEntries)
          .values({ id: `tte_${randomUUID()}`, ...entry })
          .returning();
        const row = rows[0];
        if (row === undefined) throw new Error("entry insert returned no row");
        return row;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          const constraint = pgConstraint(error) ?? "";
          if (constraint.includes("teacher")) throw new SlotClashError("teacher");
          if (constraint.includes("room")) throw new SlotClashError("room");
          throw new SlotClashError("section");
        }
        throw error;
      }
    },

    async getEntry(id) {
      const rows = await db.select().from(ttbEntries).where(eq(ttbEntries.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async deleteEntry(id) {
      const rows = await db.delete(ttbEntries).where(eq(ttbEntries.id, id)).returning();
      return rows.length > 0;
    },

    async entriesForSection(sectionId, academicYear) {
      return db
        .select()
        .from(ttbEntries)
        .where(and(eq(ttbEntries.sectionId, sectionId), eq(ttbEntries.academicYear, academicYear)))
        .orderBy(asc(ttbEntries.dayOfWeek), asc(ttbEntries.periodNo));
    },

    async entriesForTeacher(teacherId, academicYear) {
      return db
        .select()
        .from(ttbEntries)
        .where(and(eq(ttbEntries.teacherId, teacherId), eq(ttbEntries.academicYear, academicYear)))
        .orderBy(asc(ttbEntries.dayOfWeek), asc(ttbEntries.periodNo));
    },

    async entriesForTeacherDay(teacherId, academicYear, dayOfWeek) {
      return db
        .select()
        .from(ttbEntries)
        .where(
          and(
            eq(ttbEntries.teacherId, teacherId),
            eq(ttbEntries.academicYear, academicYear),
            eq(ttbEntries.dayOfWeek, dayOfWeek),
          ),
        )
        .orderBy(asc(ttbEntries.periodNo));
    },
  };
}
