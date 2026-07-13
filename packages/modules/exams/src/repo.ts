import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { exmSeries, exmSlots, type ExamSeriesRow, type ExamSlotRow } from "./db/schema";

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export class DuplicateSeriesError extends Error {
  constructor() {
    super("a series with this name already exists for the year");
    this.name = "DuplicateSeriesError";
  }
}
export class DuplicateSlotError extends Error {
  constructor() {
    super("this subject already has a slot in this series for the class");
    this.name = "DuplicateSlotError";
  }
}

export interface ExamsRepo {
  createSeries(input: { collegeId: string; name: string; academicYear: string; term: string }): Promise<ExamSeriesRow>;
  getSeries(seriesId: string): Promise<ExamSeriesRow | null>;
  listSeries(collegeId: string, academicYear: string): Promise<(ExamSeriesRow & { slotCount: number })[]>;
  deleteSeries(seriesId: string): Promise<boolean>;
  createSlot(input: Omit<ExamSlotRow, "id">): Promise<ExamSlotRow>;
  getSlot(slotId: string): Promise<ExamSlotRow | null>;
  deleteSlot(slotId: string): Promise<boolean>;
  /** A class's papers across series, soonest first. */
  slotsForClass(classId: string, academicYear?: string): Promise<ExamSlotRow[]>;
}

export function createExamsRepo(db: Db): ExamsRepo {
  return {
    async createSeries(input) {
      try {
        const rows = await db
          .insert(exmSeries)
          .values({ id: `ser_${randomUUID()}`, ...input })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateSeriesError();
        throw error;
      }
    },

    async getSeries(seriesId) {
      const rows = await db.select().from(exmSeries).where(eq(exmSeries.id, seriesId)).limit(1);
      return rows[0] ?? null;
    },

    async listSeries(collegeId, academicYear) {
      const rows = await db
        .select({
          series: exmSeries,
          slotCount: sql<number>`count(${exmSlots.id})::int`,
        })
        .from(exmSeries)
        .leftJoin(exmSlots, eq(exmSlots.seriesId, exmSeries.id))
        .where(and(eq(exmSeries.collegeId, collegeId), eq(exmSeries.academicYear, academicYear)))
        .groupBy(exmSeries.id)
        .orderBy(asc(exmSeries.name));
      return rows.map((row) => ({ ...row.series, slotCount: row.slotCount }));
    },

    async deleteSeries(seriesId) {
      const rows = await db.delete(exmSeries).where(eq(exmSeries.id, seriesId)).returning({ id: exmSeries.id });
      return rows.length > 0;
    },

    async createSlot(input) {
      try {
        const rows = await db
          .insert(exmSlots)
          .values({ id: `slt_${randomUUID()}`, ...input })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateSlotError();
        throw error;
      }
    },

    async getSlot(slotId) {
      const rows = await db.select().from(exmSlots).where(eq(exmSlots.id, slotId)).limit(1);
      return rows[0] ?? null;
    },

    async deleteSlot(slotId) {
      const rows = await db.delete(exmSlots).where(eq(exmSlots.id, slotId)).returning({ id: exmSlots.id });
      return rows.length > 0;
    },

    async slotsForClass(classId, academicYear) {
      return db
        .select()
        .from(exmSlots)
        .where(
          academicYear === undefined
            ? eq(exmSlots.classId, classId)
            : and(eq(exmSlots.classId, classId), eq(exmSlots.academicYear, academicYear)),
        )
        .orderBy(asc(exmSlots.onDate), asc(exmSlots.starts));
    },
  };
}
