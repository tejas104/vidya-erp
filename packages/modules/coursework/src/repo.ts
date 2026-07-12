import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  cwkAssignments,
  cwkMaterials,
  cwkSubmissions,
  type CwkAssignmentRow,
  type CwkMaterialRow,
  type CwkSubmissionRow,
} from "./db/schema";

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export class DuplicateTitleError extends Error {
  constructor() {
    super("an assignment with this title already exists for the subject/year");
    this.name = "DuplicateTitleError";
  }
}

export interface CourseworkRepo {
  createAssignment(input: Omit<CwkAssignmentRow, "id" | "createdAt" | "instructions" | "maxScore"> & {
    instructions?: string;
    maxScore?: string | null;
  }): Promise<CwkAssignmentRow>;
  getAssignment(id: string): Promise<CwkAssignmentRow | null>;
  assignmentsForClass(classId: string, academicYear: string): Promise<CwkAssignmentRow[]>;
  deleteAssignment(id: string): Promise<boolean>;
  submissionCount(assignmentId: string): Promise<number>;
  upsertSubmission(input: {
    assignmentId: string;
    studentId: string;
    body: string;
    objectKey: string | null;
  }): Promise<CwkSubmissionRow | null>;
  getSubmission(id: string): Promise<CwkSubmissionRow | null>;
  submissionFor(assignmentId: string, studentId: string): Promise<CwkSubmissionRow | null>;
  submissionsForAssignment(assignmentId: string): Promise<CwkSubmissionRow[]>;
  evaluate(id: string, patch: { score: string; feedback: string; evaluatedBy: string }): Promise<CwkSubmissionRow | null>;
  createMaterial(input: Omit<CwkMaterialRow, "id" | "createdAt">): Promise<CwkMaterialRow>;
  getMaterial(id: string): Promise<CwkMaterialRow | null>;
  materialsForClass(classId: string, academicYear: string): Promise<CwkMaterialRow[]>;
}

export function createCourseworkRepo(db: Db): CourseworkRepo {
  return {
    async createAssignment(input) {
      try {
        const rows = await db
          .insert(cwkAssignments)
          .values({
            id: `cwa_${randomUUID()}`,
            collegeId: input.collegeId,
            departmentId: input.departmentId,
            classId: input.classId,
            subjectId: input.subjectId,
            teacherId: input.teacherId,
            title: input.title,
            instructions: input.instructions ?? "",
            dueOn: input.dueOn,
            maxScore: input.maxScore ?? null,
            academicYear: input.academicYear,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateTitleError();
        throw error;
      }
    },
    async getAssignment(id) {
      const rows = await db.select().from(cwkAssignments).where(eq(cwkAssignments.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async assignmentsForClass(classId, academicYear) {
      return db
        .select()
        .from(cwkAssignments)
        .where(and(eq(cwkAssignments.classId, classId), eq(cwkAssignments.academicYear, academicYear)))
        .orderBy(desc(cwkAssignments.dueOn));
    },
    async deleteAssignment(id) {
      const rows = await db.delete(cwkAssignments).where(eq(cwkAssignments.id, id)).returning();
      return rows.length > 0;
    },
    async submissionCount(assignmentId) {
      const rows = await db.select().from(cwkSubmissions).where(eq(cwkSubmissions.assignmentId, assignmentId));
      return rows.length;
    },
    async upsertSubmission(input) {
      const existing = await this.submissionFor(input.assignmentId, input.studentId);
      if (existing !== null) {
        if (existing.evaluatedAt !== null) return null; // locked after evaluation
        const rows = await db
          .update(cwkSubmissions)
          .set({ body: input.body, objectKey: input.objectKey, submittedAt: new Date() })
          .where(eq(cwkSubmissions.id, existing.id))
          .returning();
        return rows[0] ?? null;
      }
      const rows = await db
        .insert(cwkSubmissions)
        .values({
          id: `cws_${randomUUID()}`,
          assignmentId: input.assignmentId,
          studentId: input.studentId,
          body: input.body,
          objectKey: input.objectKey,
        })
        .returning();
      return rows[0]!;
    },
    async getSubmission(id) {
      const rows = await db.select().from(cwkSubmissions).where(eq(cwkSubmissions.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async submissionFor(assignmentId, studentId) {
      const rows = await db
        .select()
        .from(cwkSubmissions)
        .where(and(eq(cwkSubmissions.assignmentId, assignmentId), eq(cwkSubmissions.studentId, studentId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async submissionsForAssignment(assignmentId) {
      return db.select().from(cwkSubmissions).where(eq(cwkSubmissions.assignmentId, assignmentId));
    },
    async evaluate(id, patch) {
      const rows = await db
        .update(cwkSubmissions)
        .set({ score: patch.score, feedback: patch.feedback, evaluatedBy: patch.evaluatedBy, evaluatedAt: new Date() })
        .where(eq(cwkSubmissions.id, id))
        .returning();
      return rows[0] ?? null;
    },
    async createMaterial(input) {
      const rows = await db
        .insert(cwkMaterials)
        .values({ id: `cwm_${randomUUID()}`, ...input })
        .returning();
      return rows[0]!;
    },
    async getMaterial(id) {
      const rows = await db.select().from(cwkMaterials).where(eq(cwkMaterials.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async materialsForClass(classId, academicYear) {
      return db
        .select()
        .from(cwkMaterials)
        .where(and(eq(cwkMaterials.classId, classId), eq(cwkMaterials.academicYear, academicYear)))
        .orderBy(desc(cwkMaterials.createdAt));
    },
  };
}
