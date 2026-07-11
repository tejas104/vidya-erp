import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { acdAssessments, acdMarks, type AcdAssessmentRow, type AcdMarkRow } from "../db/schema";

export type AssessmentKind = "exam" | "quiz" | "assignment";

export class DuplicateAssessmentError extends Error {
  constructor() {
    super("an assessment with this name already exists for this class/subject/year");
    this.name = "DuplicateAssessmentError";
  }
}

export class MarksExistError extends Error {
  constructor() {
    super("marks exist for this assessment; deletion is blocked");
    this.name = "MarksExistError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  // drizzle >=0.44 wraps driver errors in DrizzleQueryError; the pg code rides on .cause
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export interface NewAssessment {
  readonly classId: string;
  readonly subjectId: string;
  readonly kind: AssessmentKind;
  readonly name: string;
  readonly academicYear: string;
  readonly maxScore: number;
  readonly heldOn?: string;
  readonly collegeId: string;
  readonly departmentId: string;
  readonly createdBy: string;
}

/** One entry's outcome from a bulk marksheet write. */
export interface MarkDiff {
  readonly studentId: string;
  readonly before: number | null;
  readonly after: number;
  readonly changed: boolean;
}

export interface MarksRepo {
  createAssessment(input: NewAssessment): Promise<AcdAssessmentRow>;
  getAssessment(id: string): Promise<AcdAssessmentRow | null>;
  /** Throws MarksExistError when marks reference it (RESTRICT). */
  deleteAssessment(id: string): Promise<boolean>;
  listAssessmentsByClass(classId: string, academicYear?: string): Promise<AcdAssessmentRow[]>;
  /** Upserts every entry, returning per-entry before/after diffs. */
  upsertMarks(
    assessmentId: string,
    entries: readonly { studentId: string; score: number }[],
    recordedBy: string,
  ): Promise<MarkDiff[]>;
  getMark(id: string): Promise<AcdMarkRow | null>;
  updateMark(
    id: string,
    score: number,
    recordedBy: string,
  ): Promise<{ before: number; after: number } | null>;
  marksForAssessment(assessmentId: string): Promise<AcdMarkRow[]>;
  marksForStudent(
    studentId: string,
    filter: { academicYear?: string; subjectId?: string },
  ): Promise<{ mark: AcdMarkRow; assessment: AcdAssessmentRow }[]>;
  /** Keyset page over a year's marks (analytics read model, #5). */
  pageMarks(
    academicYear: string,
    afterMarkId: string | null,
    limit: number,
  ): Promise<{ mark: AcdMarkRow; assessment: AcdAssessmentRow }[]>;
}

export function createMarksRepo(db: Db): MarksRepo {
  return {
    async createAssessment(input) {
      try {
        const rows = await db
          .insert(acdAssessments)
          .values({
            id: `asm_${randomUUID()}`,
            classId: input.classId,
            subjectId: input.subjectId,
            kind: input.kind,
            name: input.name,
            academicYear: input.academicYear,
            maxScore: input.maxScore.toFixed(2),
            heldOn: input.heldOn ?? null,
            collegeId: input.collegeId,
            departmentId: input.departmentId,
            createdBy: input.createdBy,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicateAssessmentError();
        }
        throw error;
      }
    },

    async getAssessment(id) {
      const rows = await db.select().from(acdAssessments).where(eq(acdAssessments.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async deleteAssessment(id) {
      try {
        const rows = await db
          .delete(acdAssessments)
          .where(eq(acdAssessments.id, id))
          .returning({ id: acdAssessments.id });
        return rows.length > 0;
      } catch (error) {
        if (pgErrorCode(error) === "23503") {
          throw new MarksExistError();
        }
        throw error;
      }
    },

    async listAssessmentsByClass(classId, academicYear) {
      return db
        .select()
        .from(acdAssessments)
        .where(
          academicYear === undefined
            ? eq(acdAssessments.classId, classId)
            : and(eq(acdAssessments.classId, classId), eq(acdAssessments.academicYear, academicYear)),
        )
        .orderBy(asc(acdAssessments.createdAt));
    },

    async upsertMarks(assessmentId, entries, recordedBy) {
      const existing = await this.marksForAssessment(assessmentId);
      const byStudent = new Map(existing.map((mark) => [mark.studentId, mark]));
      const diffs: MarkDiff[] = [];
      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const current = byStudent.get(entry.studentId);
          if (current === undefined) {
            await tx.insert(acdMarks).values({
              id: `mrk_${randomUUID()}`,
              assessmentId,
              studentId: entry.studentId,
              score: entry.score.toFixed(2),
              recordedBy,
            });
            diffs.push({ studentId: entry.studentId, before: null, after: entry.score, changed: true });
          } else {
            const before = Number(current.score);
            if (before === entry.score) {
              diffs.push({ studentId: entry.studentId, before, after: entry.score, changed: false });
              continue;
            }
            await tx
              .update(acdMarks)
              .set({ score: entry.score.toFixed(2), recordedBy, updatedAt: new Date() })
              .where(eq(acdMarks.id, current.id));
            diffs.push({ studentId: entry.studentId, before, after: entry.score, changed: true });
          }
        }
      });
      return diffs;
    },

    async getMark(id) {
      const rows = await db.select().from(acdMarks).where(eq(acdMarks.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async updateMark(id, score, recordedBy) {
      const existing = await this.getMark(id);
      if (existing === null) {
        return null;
      }
      await db
        .update(acdMarks)
        .set({ score: score.toFixed(2), recordedBy, updatedAt: new Date() })
        .where(eq(acdMarks.id, id));
      return { before: Number(existing.score), after: score };
    },

    async marksForAssessment(assessmentId) {
      return db
        .select()
        .from(acdMarks)
        .where(eq(acdMarks.assessmentId, assessmentId))
        .orderBy(asc(acdMarks.studentId));
    },

    async pageMarks(academicYear, afterMarkId, limit) {
      const conditions = [eq(acdAssessments.academicYear, academicYear)];
      if (afterMarkId !== null) {
        conditions.push(gte(acdMarks.id, afterMarkId));
      }
      const rows = await db
        .select({ mark: acdMarks, assessment: acdAssessments })
        .from(acdMarks)
        .innerJoin(acdAssessments, eq(acdMarks.assessmentId, acdAssessments.id))
        .where(and(...conditions))
        .orderBy(acdMarks.id)
        .limit(limit + (afterMarkId === null ? 0 : 1));
      return afterMarkId === null ? rows : rows.filter((row) => row.mark.id !== afterMarkId);
    },

    async marksForStudent(studentId, filter) {
      const conditions = [eq(acdMarks.studentId, studentId)];
      if (filter.academicYear !== undefined) {
        conditions.push(eq(acdAssessments.academicYear, filter.academicYear));
      }
      if (filter.subjectId !== undefined) {
        conditions.push(eq(acdAssessments.subjectId, filter.subjectId));
      }
      return db
        .select({ mark: acdMarks, assessment: acdAssessments })
        .from(acdMarks)
        .innerJoin(acdAssessments, eq(acdMarks.assessmentId, acdAssessments.id))
        .where(and(...conditions))
        .orderBy(desc(acdMarks.updatedAt));
    },
  };
}
