import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { sylTopics, sylUnits, type SylTopicRow, type SylUnitRow } from "./db/schema";

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export class DuplicateTitleError extends Error {
  constructor() {
    super("a unit with this title already exists for the subject/year");
    this.name = "DuplicateTitleError";
  }
}

export interface SyllabusRepo {
  createUnit(input: Omit<SylUnitRow, "createdAt">): Promise<SylUnitRow>;
  getUnit(unitId: string): Promise<SylUnitRow | null>;
  updateUnit(unitId: string, patch: { title?: string; position?: number }): Promise<SylUnitRow | null>;
  deleteUnit(unitId: string): Promise<void>;
  unitsForClass(classId: string, academicYear: string): Promise<SylUnitRow[]>;
  createTopic(input: { id: string; unitId: string; title: string; position: number }): Promise<SylTopicRow>;
  getTopic(topicId: string): Promise<SylTopicRow | null>;
  updateTopic(topicId: string, patch: { title?: string; position?: number }): Promise<SylTopicRow | null>;
  deleteTopic(topicId: string): Promise<void>;
  setCoverage(topicId: string, taughtOn: string | null, taughtBy: string | null): Promise<SylTopicRow | null>;
  topicsForUnits(unitIds: string[]): Promise<SylTopicRow[]>;
}

export function createSyllabusRepo(db: Db): SyllabusRepo {
  return {
    async createUnit(input) {
      try {
        const rows = await db.insert(sylUnits).values(input).returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateTitleError();
        throw error;
      }
    },
    async getUnit(unitId) {
      const rows = await db.select().from(sylUnits).where(eq(sylUnits.id, unitId)).limit(1);
      return rows[0] ?? null;
    },
    async updateUnit(unitId, patch) {
      if (Object.keys(patch).length === 0) return this.getUnit(unitId);
      const rows = await db.update(sylUnits).set(patch).where(eq(sylUnits.id, unitId)).returning();
      return rows[0] ?? null;
    },
    async deleteUnit(unitId) {
      await db.transaction(async (tx) => {
        await tx.delete(sylTopics).where(eq(sylTopics.unitId, unitId));
        await tx.delete(sylUnits).where(eq(sylUnits.id, unitId));
      });
    },
    async unitsForClass(classId, academicYear) {
      return db
        .select()
        .from(sylUnits)
        .where(and(eq(sylUnits.classId, classId), eq(sylUnits.academicYear, academicYear)));
    },
    async createTopic(input) {
      const rows = await db.insert(sylTopics).values(input).returning();
      return rows[0]!;
    },
    async getTopic(topicId) {
      const rows = await db.select().from(sylTopics).where(eq(sylTopics.id, topicId)).limit(1);
      return rows[0] ?? null;
    },
    async updateTopic(topicId, patch) {
      if (Object.keys(patch).length === 0) return this.getTopic(topicId);
      const rows = await db.update(sylTopics).set(patch).where(eq(sylTopics.id, topicId)).returning();
      return rows[0] ?? null;
    },
    async deleteTopic(topicId) {
      await db.delete(sylTopics).where(eq(sylTopics.id, topicId));
    },
    async setCoverage(topicId, taughtOn, taughtBy) {
      const rows = await db
        .update(sylTopics)
        .set({ taughtOn, taughtBy })
        .where(eq(sylTopics.id, topicId))
        .returning();
      return rows[0] ?? null;
    },
    async topicsForUnits(unitIds) {
      if (unitIds.length === 0) return [];
      return db.select().from(sylTopics).where(inArray(sylTopics.unitId, unitIds));
    },
  };
}

/** Pure rollup used to assemble the coverage view — never stored. */
export function coveragePct(topics: { taughtOn: string | null }[]): number {
  if (topics.length === 0) return 0;
  const taught = topics.filter((t) => t.taughtOn !== null).length;
  return Math.round((taught / topics.length) * 100);
}
