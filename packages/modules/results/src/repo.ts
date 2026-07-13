import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  resGradeScales,
  resPublications,
  resSubjectCredits,
  type GradeScaleRow,
  type PublicationRow,
  type SubjectCreditRow,
} from "./db/schema";
import type { Band } from "./gpa";

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export class DuplicateScaleError extends Error {
  constructor() {
    super("a grade scale with this name already exists for this college");
    this.name = "DuplicateScaleError";
  }
}
export class ScaleInUseError extends Error {
  constructor() {
    super("this scale is referenced by a publication and is frozen");
    this.name = "ScaleInUseError";
  }
}
export class AlreadyPublishedError extends Error {
  constructor() {
    super("results for this class, year and term are already published");
    this.name = "AlreadyPublishedError";
  }
}

export interface ResultsRepo {
  createScale(collegeId: string, name: string, bands: Band[]): Promise<GradeScaleRow>;
  getScale(scaleId: string): Promise<GradeScaleRow | null>;
  listScales(collegeId: string): Promise<GradeScaleRow[]>;
  updateScale(scaleId: string, patch: { name?: string; bands?: Band[] }): Promise<GradeScaleRow | null>;
  deleteScale(scaleId: string): Promise<boolean>;
  /** True when any publication references this scale (frozen). */
  scaleInUse(scaleId: string): Promise<boolean>;
  creditsFor(classId: string, academicYear: string): Promise<SubjectCreditRow[]>;
  /** Full replace for (class, year) — the grid's one save. */
  replaceCredits(
    position: { collegeId: string; departmentId: string; classId: string },
    academicYear: string,
    entries: { subjectId: string; credits: number }[],
  ): Promise<SubjectCreditRow[]>;
  publish(input: {
    collegeId: string;
    departmentId: string;
    classId: string;
    academicYear: string;
    term: string;
    scaleId: string;
    publishedBy: string;
  }): Promise<PublicationRow>;
  publicationsForClass(classId: string, academicYear?: string): Promise<PublicationRow[]>;
}

export function createResultsRepo(db: Db): ResultsRepo {
  return {
    async createScale(collegeId, name, bands) {
      try {
        const rows = await db
          .insert(resGradeScales)
          .values({ id: `scl_${randomUUID()}`, collegeId, name, bands })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateScaleError();
        throw error;
      }
    },

    async getScale(scaleId) {
      const rows = await db.select().from(resGradeScales).where(eq(resGradeScales.id, scaleId)).limit(1);
      return rows[0] ?? null;
    },

    async listScales(collegeId) {
      return db.select().from(resGradeScales).where(eq(resGradeScales.collegeId, collegeId)).orderBy(asc(resGradeScales.name));
    },

    async updateScale(scaleId, patch) {
      if (await this.scaleInUse(scaleId)) throw new ScaleInUseError();
      try {
        const rows = await db
          .update(resGradeScales)
          .set({ ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.bands !== undefined ? { bands: patch.bands } : {}) })
          .where(eq(resGradeScales.id, scaleId))
          .returning();
        return rows[0] ?? null;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateScaleError();
        throw error;
      }
    },

    async deleteScale(scaleId) {
      try {
        const rows = await db.delete(resGradeScales).where(eq(resGradeScales.id, scaleId)).returning({ id: resGradeScales.id });
        return rows.length > 0;
      } catch (error) {
        if (pgErrorCode(error) === "23503") throw new ScaleInUseError();
        throw error;
      }
    },

    async scaleInUse(scaleId) {
      const rows = await db
        .select({ id: resPublications.id })
        .from(resPublications)
        .where(eq(resPublications.scaleId, scaleId))
        .limit(1);
      return rows.length > 0;
    },

    async creditsFor(classId, academicYear) {
      return db
        .select()
        .from(resSubjectCredits)
        .where(and(eq(resSubjectCredits.classId, classId), eq(resSubjectCredits.academicYear, academicYear)));
    },

    async replaceCredits(position, academicYear, entries) {
      return db.transaction(async (tx) => {
        await tx
          .delete(resSubjectCredits)
          .where(and(eq(resSubjectCredits.classId, position.classId), eq(resSubjectCredits.academicYear, academicYear)));
        if (entries.length === 0) return [];
        return tx
          .insert(resSubjectCredits)
          .values(
            entries.map((entry) => ({
              id: `crd_${randomUUID()}`,
              collegeId: position.collegeId,
              departmentId: position.departmentId,
              classId: position.classId,
              subjectId: entry.subjectId,
              academicYear,
              credits: entry.credits,
            })),
          )
          .returning();
      });
    },

    async publish(input) {
      try {
        const rows = await db
          .insert(resPublications)
          .values({
            id: `pub_${randomUUID()}`,
            collegeId: input.collegeId,
            departmentId: input.departmentId,
            classId: input.classId,
            academicYear: input.academicYear,
            term: input.term,
            scaleId: input.scaleId,
            publishedBy: input.publishedBy,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new AlreadyPublishedError();
        throw error;
      }
    },

    async publicationsForClass(classId, academicYear) {
      return db
        .select()
        .from(resPublications)
        .where(
          academicYear === undefined
            ? eq(resPublications.classId, classId)
            : and(eq(resPublications.classId, classId), eq(resPublications.academicYear, academicYear)),
        )
        .orderBy(desc(resPublications.publishedAt));
    },
  };
}
