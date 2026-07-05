import type { PeopleDirectory } from "@vidya/module-people";
import type {
  AssessmentKind,
  MarkDiff,
  MarksRepo,
  NewAssessment,
} from "../repo/marks-repo";
import type { AcdAssessmentRow, AcdMarkRow } from "../db/schema";
import { InvalidEntriesError } from "./attendance-service";

export class UnknownClassError extends Error {
  constructor(classId: string) {
    super(`unknown classId "${classId}"`);
    this.name = "UnknownClassError";
  }
}

export class SubjectOutsideDepartmentError extends Error {
  constructor() {
    super("the subject does not belong to the class's department");
    this.name = "SubjectOutsideDepartmentError";
  }
}

export class ScoreExceedsMaxError extends Error {
  constructor(max: number) {
    super(`score exceeds the assessment's maxScore (${max})`);
    this.name = "ScoreExceedsMaxError";
  }
}

export interface MarksServiceDeps {
  readonly repo: MarksRepo;
  readonly directory: PeopleDirectory;
}

export class MarksService {
  constructor(private readonly deps: MarksServiceDeps) {}

  /** The class's full path — the org half of the marks ResourceRef. */
  async classPosition(classId: string) {
    const path = await this.deps.directory.classPath(classId);
    if (path === null || path.departmentId === undefined || path.classId === undefined) {
      return null;
    }
    return {
      collegeId: path.collegeId,
      departmentId: path.departmentId,
      classId: path.classId,
    };
  }

  async createAssessment(input: {
    classId: string;
    subjectId: string;
    kind: AssessmentKind;
    name: string;
    academicYear: string;
    maxScore: number;
    heldOn?: string;
    createdBy: string;
  }): Promise<AcdAssessmentRow> {
    const position = await this.classPosition(input.classId);
    if (position === null) {
      throw new UnknownClassError(input.classId);
    }
    const subjectDepartment = await this.deps.directory.subjectDepartment(input.subjectId);
    if (subjectDepartment === null) {
      throw new UnknownClassError(`subject ${input.subjectId}`);
    }
    if (subjectDepartment !== position.departmentId) {
      throw new SubjectOutsideDepartmentError();
    }
    const assessment: NewAssessment = {
      ...input,
      collegeId: position.collegeId,
      departmentId: position.departmentId,
    };
    return this.deps.repo.createAssessment(assessment);
  }

  getAssessment(id: string): Promise<AcdAssessmentRow | null> {
    return this.deps.repo.getAssessment(id);
  }

  deleteAssessment(id: string): Promise<boolean> {
    return this.deps.repo.deleteAssessment(id);
  }

  listAssessments(classId: string, academicYear?: string): Promise<AcdAssessmentRow[]> {
    return this.deps.repo.listAssessmentsByClass(classId, academicYear);
  }

  /**
   * All-or-nothing marksheet write: every entry validated (score within
   * the assessment's maxScore; student enrolled in THIS class) before any
   * write. Returns per-entry diffs — the payload of the grade-change audit.
   */
  async enterMarks(
    assessment: AcdAssessmentRow,
    entries: readonly { studentId: string; score: number }[],
    recordedBy: string,
  ): Promise<MarkDiff[]> {
    const maxScore = Number(assessment.maxScore);
    const invalid: { studentId: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.studentId)) {
        invalid.push({ studentId: entry.studentId, reason: "duplicated in this request" });
        continue;
      }
      seen.add(entry.studentId);
      if (entry.score > maxScore) {
        invalid.push({
          studentId: entry.studentId,
          reason: `score ${entry.score} exceeds maxScore ${maxScore}`,
        });
      }
    }
    // Enrollment check: the student's live position must be in this class.
    for (const entry of entries) {
      if (invalid.some((row) => row.studentId === entry.studentId)) {
        continue;
      }
      const position = await this.deps.directory.studentPosition(entry.studentId);
      if (position === null) {
        invalid.push({ studentId: entry.studentId, reason: "no such student" });
      } else if (position.classId !== assessment.classId) {
        invalid.push({ studentId: entry.studentId, reason: "not enrolled in this class" });
      }
    }
    if (invalid.length > 0) {
      throw new InvalidEntriesError(invalid);
    }
    return this.deps.repo.upsertMarks(assessment.id, entries, recordedBy);
  }

  getMark(id: string): Promise<AcdMarkRow | null> {
    return this.deps.repo.getMark(id);
  }

  async correctMark(
    mark: AcdMarkRow,
    assessment: AcdAssessmentRow,
    score: number,
    recordedBy: string,
  ): Promise<{ before: number; after: number }> {
    if (score > Number(assessment.maxScore)) {
      throw new ScoreExceedsMaxError(Number(assessment.maxScore));
    }
    const result = await this.deps.repo.updateMark(mark.id, score, recordedBy);
    if (result === null) {
      throw new Error("mark vanished during correction");
    }
    return result;
  }

  marksForAssessment(assessmentId: string): Promise<AcdMarkRow[]> {
    return this.deps.repo.marksForAssessment(assessmentId);
  }

  async studentExists(studentId: string): Promise<boolean> {
    return (await this.deps.directory.studentsExist([studentId])).has(studentId);
  }

  marksForStudent(studentId: string, filter: { academicYear?: string; subjectId?: string }) {
    return this.deps.repo.marksForStudent(studentId, filter);
  }
}
