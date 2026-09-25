import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { bandFor, type Band } from "@vidya/module-results";
import { assessments, assessmentTypes, marks, schTerms, type SchoolAssessmentRow, type SchoolMarkRow, type SchTermRow } from "./db/schema";

export class SchoolMarksError extends Error {
  constructor(readonly status: 409 | 422, message: string) { super(message); this.name = "SchoolMarksError"; }
}

export interface NewSchoolAssessment {
  termId: string; typeId: string; classId: string; subjectId: string;
  collegeId: string; departmentId: string; name: string; maxScore: number; heldOn: string; createdBy: string;
  scale: { id: string; name: string; bands: Band[] };
}

export interface SchoolMarksRepo {
  get(id: string): Promise<SchoolAssessmentRow | null>;
  list(classId: string, academicYear: string): Promise<SchoolAssessmentRow[]>;
  create(input: NewSchoolAssessment): Promise<SchoolAssessmentRow>;
  readMarks(assessmentId: string): Promise<SchoolMarkRow[]>;
  saveMarks(assessment: SchoolAssessmentRow, entries: { studentId: string; score: number; expectedScore?: number | null }[], recordedBy: string): Promise<{ before: SchoolMarkRow[]; marks: SchoolMarkRow[] }>;
}

function requireOpen(term: SchTermRow | undefined): asserts term is SchTermRow {
  if (!term || term.status !== "open") throw new SchoolMarksError(409, "This term is closed. Ask an administrator to reopen it with a reason before changing marks.");
}

export function createSchoolMarksRepo(db: Db): SchoolMarksRepo {
  return {
    async get(id) { return (await db.select().from(assessments).where(eq(assessments.id, id)).limit(1))[0] ?? null; },
    list: (classId, year) => db.select().from(assessments).where(and(eq(assessments.classId, classId), eq(assessments.academicYear, year))).orderBy(asc(assessments.heldOn), asc(assessments.name)),
    readMarks: (assessmentId) => db.select().from(marks).where(eq(marks.assessmentId, assessmentId)).orderBy(asc(marks.studentId)),
    async create(input) {
      try {
        return await db.transaction(async (tx) => {
          const [term] = await tx.select().from(schTerms).where(eq(schTerms.id, input.termId)).for("update");
          requireOpen(term);
          const [type] = await tx.select().from(assessmentTypes).where(eq(assessmentTypes.id, input.typeId));
          if (type?.termId !== term.id || input.collegeId !== term.collegeId || input.departmentId !== term.departmentId) throw new SchoolMarksError(422, "The class and assessment type must belong to this term's school.");
          if (input.heldOn < term.startsOn || input.heldOn > term.endsOn) throw new SchoolMarksError(422, "The assessment date must fall within the term.");
          if (term.scaleId && term.scaleId !== input.scale.id) throw new SchoolMarksError(409, "This term already uses a different grade scale. Reload the term setup.");
          if (!term.gradeBands) {
            await tx.update(schTerms).set({ scaleId: input.scale.id, scaleName: input.scale.name, gradeBands: input.scale.bands, updatedAt: new Date() }).where(eq(schTerms.id, term.id));
          }
          const { scale: _scale, ...data } = input;
          const [saved] = await tx.insert(assessments).values({ ...data, id: `sas_${randomUUID()}`, maxScore: input.maxScore.toFixed(2), academicYear: term.academicYear }).returning();
          return saved!;
        });
      } catch (caught) {
        const error = caught as { code?: string; cause?: { code?: string } };
        if ((error.code ?? error.cause?.code) === "23505") throw new SchoolMarksError(409, "An assessment with this name already exists for this subject and term.");
        throw caught;
      }
    },
    async saveMarks(assessment, entries, recordedBy) {
      return db.transaction(async (tx) => {
        const [term] = await tx.select().from(schTerms).where(eq(schTerms.id, assessment.termId)).for("update");
        requireOpen(term);
        if (!term.gradeBands) throw new SchoolMarksError(409, "This term has no saved grading basis.");
        const before = await tx.select().from(marks).where(and(eq(marks.assessmentId, assessment.id), inArray(marks.studentId, entries.map((entry) => entry.studentId))));
        const beforeByStudent = new Map(before.map((mark) => [mark.studentId, Number(mark.score)]));
        if (entries.some((entry) => entry.expectedScore !== undefined &&
            entry.expectedScore !== (beforeByStudent.get(entry.studentId) ?? null))) {
          throw new SchoolMarksError(409, "Marks changed since the import preview. Download a fresh roster and review again.");
        }
        const saved: SchoolMarkRow[] = [];
        for (const entry of entries) {
          if (entry.score > Number(assessment.maxScore)) throw new SchoolMarksError(422, "A score exceeds this assessment's maximum.");
          const percentage = Math.round(entry.score / Number(assessment.maxScore) * 10000) / 100;
          const band = bandFor(term.gradeBands, percentage);
          const values = { score: entry.score.toFixed(2), percentage: percentage.toFixed(2), grade: band.grade, points: band.points.toFixed(2), recordedBy, updatedAt: new Date() };
          const [row] = await tx.insert(marks).values({ id: `smk_${randomUUID()}`, assessmentId: assessment.id, studentId: entry.studentId, ...values })
            .onConflictDoUpdate({ target: [marks.assessmentId, marks.studentId], set: values }).returning();
          saved.push(row!);
        }
        return { before, marks: saved };
      });
    },
  };
}
