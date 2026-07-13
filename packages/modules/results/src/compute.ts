import type { OrgPath, Principal } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { bandFor, cgpa, meanPct, sgpa, type Band } from "./gpa";
import type { ResultsRepo } from "./repo";

export interface SubjectResultView {
  subjectId: string;
  subjectName: string;
  credits: number;
  pct: number;
  grade: string;
  points: number;
}

export interface TermResultView {
  term: string;
  academicYear: string;
  publishedAt: string;
  sgpa: number;
  subjects: SubjectResultView[];
}

/** Same overlap rule as the noticeboard: no defined level may contradict. */
export function orgOverlaps(a: OrgPath, b: OrgPath): boolean {
  if (a.collegeId !== b.collegeId) return false;
  if (a.departmentId !== undefined && b.departmentId !== undefined && a.departmentId !== b.departmentId) return false;
  if (a.classId !== undefined && b.classId !== undefined && a.classId !== b.classId) return false;
  return true;
}

export interface ResultsComputerDeps {
  readonly repo: ResultsRepo;
  readonly directory: PeopleDirectory;
  readonly marks: AcademicsReadModel;
}

export function createResultsComputer(deps: ResultsComputerDeps) {
  /** Distinct student ids enrolled in any of the class's sections for the year. */
  async function classRoster(classId: string, academicYear: string): Promise<string[]> {
    const sections = await deps.directory.sectionsOfClass(classId);
    const students = new Set<string>();
    for (const section of sections) {
      for (const enrollment of await deps.directory.sectionRoster(section.sectionId)) {
        if (enrollment.academicYear === academicYear) students.add(enrollment.studentId);
      }
    }
    return [...students];
  }

  /** One student's banded subject results: marks of this class/year × credits × scale. */
  async function subjectResults(
    studentId: string,
    classId: string,
    academicYear: string,
    creditBySubject: Map<string, number>,
    subjectNames: Map<string, string>,
    bands: Band[],
  ): Promise<SubjectResultView[]> {
    const marks = await deps.marks.studentMarks(studentId, academicYear);
    const pctsBySubject = new Map<string, number[]>();
    for (const mark of marks) {
      const subjectId = mark.position.subjectId;
      if (mark.position.classId !== classId || !creditBySubject.has(subjectId)) continue;
      const list = pctsBySubject.get(subjectId) ?? [];
      list.push(mark.scorePct);
      pctsBySubject.set(subjectId, list);
    }
    const results: SubjectResultView[] = [];
    for (const [subjectId, pcts] of pctsBySubject) {
      const pct = meanPct(pcts);
      if (pct === null) continue;
      const band = bandFor(bands, pct);
      results.push({
        subjectId,
        subjectName: subjectNames.get(subjectId) ?? subjectId,
        credits: creditBySubject.get(subjectId)!,
        pct,
        grade: band.grade,
        points: band.points,
      });
    }
    results.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
    return results;
  }

  /** The publication gate: a student's published terms + CGPA. Unpublished = absent. */
  async function publishedTerms(studentId: string, classId: string): Promise<{ terms: TermResultView[]; cgpa: number | null }> {
    const publications = await deps.repo.publicationsForClass(classId);
    const terms: TermResultView[] = [];
    const weights: { sgpa: number; credits: number }[] = [];
    for (const publication of publications) {
      const scale = await deps.repo.getScale(publication.scaleId);
      if (scale === null) continue;
      const credits = await deps.repo.creditsFor(classId, publication.academicYear);
      if (credits.length === 0) continue;
      const creditBySubject = new Map(credits.map((row) => [row.subjectId, row.credits]));
      const subjectNames = await deps.directory.namesFor([...creditBySubject.keys()]);
      const subjects = await subjectResults(studentId, classId, publication.academicYear, creditBySubject, subjectNames, scale.bands);
      const value = sgpa(subjects);
      if (value === null) continue;
      terms.push({
        term: publication.term,
        academicYear: publication.academicYear,
        publishedAt: publication.publishedAt.toISOString(),
        sgpa: value,
        subjects,
      });
      weights.push({ sgpa: value, credits: subjects.reduce((sum, subject) => sum + subject.credits, 0) });
    }
    return { terms, cgpa: cgpa(weights) };
  }

  return { classRoster, subjectResults, publishedTerms };
}

export type ResultsComputer = ReturnType<typeof createResultsComputer>;

// ---------------------------------------------------------------------------
// Grade-card read surface for the reporting module (injected, ADR pattern:
// cross-module reads via read-model interfaces — reporting never imports us).
// ---------------------------------------------------------------------------

export interface GradeCardData {
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  terms: TermResultView[];
  cgpa: number | null;
}

export type GradeCardResult =
  | { access: "ok"; data: GradeCardData }
  | { access: "forbidden" }
  | { access: "not-found" };

export type GradeCardSource = (principal: Principal, studentId: string) => Promise<GradeCardResult>;

/** Access + data in one call: the student themself (identity link) or staff
 * whose grant org-overlaps the student's position. Fail closed. */
export function createGradeCardSource(deps: ResultsComputerDeps): GradeCardSource {
  const computer = createResultsComputer(deps);
  return async (principal, studentId) => {
    const brief = (await deps.directory.studentsBrief([studentId])).get(studentId);
    if (brief === undefined) return { access: "not-found" };
    const position = await deps.directory.studentPosition(studentId);
    if (position === null || position.classId === undefined) return { access: "not-found" };

    const own = await deps.directory.studentByIdentityUser(principal.id);
    const isSelf = own !== null && own.studentId === studentId;
    const staffCovers = principal.grants.some((grant) => orgOverlaps(grant.org, position));
    if (!isSelf && !staffCovers) return { access: "forbidden" };

    const classId = position.classId;
    const names = await deps.directory.namesFor([classId]);
    const { terms, cgpa } = await computer.publishedTerms(studentId, classId);
    return {
      access: "ok",
      data: {
        studentId,
        studentName: brief.fullName,
        admissionNo: brief.admissionNo,
        className: names.get(classId) ?? classId,
        terms,
        cgpa,
      },
    };
  };
}
