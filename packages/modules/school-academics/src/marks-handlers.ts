import type { OrgPath, Principal, ResourceRef, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TermsRepo } from "./repo";
import type { AssessmentTypesRepo } from "./assessment-types-repo";
import { SchoolMarksError, type SchoolMarksRepo } from "./marks-repo";
import { newSchoolAssessmentSchema, schoolMarksInputSchema, type SchoolGradeScales } from "./marks-contracts";
import type { SchoolAssessmentRow, SchoolMarkRow } from "./db/schema";

export function schoolAssessmentRef(row: Pick<SchoolAssessmentRow, "collegeId" | "departmentId" | "classId" | "subjectId">): ResourceRef {
  return { module: "school-academics", resourceType: "assessment", org: { collegeId: row.collegeId, departmentId: row.departmentId, classId: row.classId }, subjectId: row.subjectId };
}
export function schoolAssessmentView(row: SchoolAssessmentRow) {
  return { id: row.id, termId: row.termId, typeId: row.typeId, classId: row.classId, subjectId: row.subjectId, name: row.name, academicYear: row.academicYear, maxScore: Number(row.maxScore), heldOn: row.heldOn };
}
export function schoolMarkView(row: SchoolMarkRow) {
  return { ...row, score: Number(row.score), percentage: Number(row.percentage), points: Number(row.points), updatedAt: row.updatedAt.toISOString() };
}

export function createSchoolMarksHandlers(deps: { repo: SchoolMarksRepo; terms: TermsRepo; types: AssessmentTypesRepo; directory: PeopleDirectory; gradeScales: SchoolGradeScales; scopeChecker: ScopeChecker }): Record<string, RouteHandler> {
  const fail = (status: number, message: string) => ({ status, body: { message } });
  const classRef = (org: OrgPath): ResourceRef => ({ module: "school-academics", resourceType: "class", org });
  const classSetup: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { classId } = ctx.request.params as { classId: string };
    const { academicYear } = ctx.request.query as { academicYear: string };
    const org = await deps.directory.classPath(classId);
    if (!org) return fail(404, "no such class");
    if (!deps.scopeChecker.check(principal, "read", classRef(org)).granted) return fail(403, "access denied");
    // An authorized class needs its school's common academic configuration;
    // this exposes no other class's pupils, assessments or marks.
    const [terms, scales] = await Promise.all([deps.terms.list([org.collegeId], academicYear), deps.gradeScales.listScales(org.collegeId)]);
    return { status: 200, body: { terms: await Promise.all(terms.map(async (term) => ({ id: term.id, name: term.name, academicYear: term.academicYear, startsOn: term.startsOn, endsOn: term.endsOn, status: term.status, scaleId: term.scaleId, scaleName: term.scaleName, types: (await deps.types.list(term.id)).map(({ id, name, weight }) => ({ id, name, weight })) }))), scales: scales.map(({ id, name }) => ({ id, name })) } };
  };
  const list: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const { classId } = ctx.request.params as { classId: string };
    const { academicYear } = ctx.request.query as { academicYear: string };
    const org = await deps.directory.classPath(classId);
    if (!org) return fail(404, "no such class");
    if (!deps.scopeChecker.check(principal, "read", classRef(org)).granted) return fail(403, "access denied");
    const rows = await deps.repo.list(classId, academicYear);
    return { status: 200, body: { assessments: rows.filter((row) => deps.scopeChecker.check(principal, "read", schoolAssessmentRef(row)).granted).map(schoolAssessmentView) } };
  };
  const create: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const parsed = newSchoolAssessmentSchema.safeParse(ctx.request.body);
    if (!parsed.success) return fail(422, "invalid assessment");
    const body = parsed.data;
    const org = await deps.directory.classPath(body.classId);
    if (!org?.departmentId || !org.classId) return fail(404, "no such class");
    const ref = schoolAssessmentRef({ collegeId: org.collegeId, departmentId: org.departmentId, classId: org.classId, subjectId: body.subjectId });
    if (!deps.scopeChecker.check(principal, "create", ref).granted) return fail(403, "Only the assigned subject teacher can create this assessment.");
    const term = await deps.terms.get(body.termId);
    if (!term) return fail(404, "no such term");
    // These comparisons enforce academic relationships, not caller containment;
    // access was decided above by the shared checker against the resolved class.
    if (term.collegeId !== org.collegeId || term.departmentId !== org.departmentId || await deps.directory.subjectDepartment(body.subjectId) !== org.departmentId) return fail(422, "The subject, class and term must belong to the same school.");
    const scale = term.gradeBands && term.scaleId && term.scaleName
      ? { id: term.scaleId, collegeId: term.collegeId, name: term.scaleName, bands: term.gradeBands }
      : await deps.gradeScales.getScale(body.scaleId);
    if (!scale || scale.collegeId !== org.collegeId) return fail(422, "Choose a grade scale configured for this school.");
    if (scale.id !== body.scaleId) return fail(409, "The term already uses a different grade scale. Reload its setup.");
    try {
      const row = await deps.repo.create({ termId: body.termId, typeId: body.typeId, classId: org.classId, subjectId: body.subjectId, collegeId: org.collegeId, departmentId: org.departmentId, name: body.name, maxScore: body.maxScore, heldOn: body.heldOn, createdBy: principal.id, scale });
      return { status: 201, body: schoolAssessmentView(row), audit: { org: ref.org, resourceId: row.id, details: { termId: row.termId, typeId: row.typeId, classId: row.classId, subjectId: row.subjectId, scaleId: scale.id, gradeBands: scale.bands, maxScore: body.maxScore } } };
    } catch (caught) { if (caught instanceof SchoolMarksError) return fail(caught.status, caught.message); throw caught; }
  };
  function markHandler(write: boolean): RouteHandler {
    return async (ctx) => {
      const principal = ctx.principal as Principal;
      const { assessmentId } = ctx.request.params as { assessmentId: string };
      const assessment = await deps.repo.get(assessmentId);
      if (!assessment) return fail(404, "no such assessment");
      if (!deps.scopeChecker.check(principal, write ? "update" : "read", schoolAssessmentRef(assessment)).granted) return fail(403, "access denied");
      const term = await deps.terms.get(assessment.termId);
      if (!term) return fail(404, "no such term");
      if (!write) return { status: 200, body: { marks: (await deps.repo.readMarks(assessmentId)).map(schoolMarkView), termStatus: term.status } };
      if (term.status !== "open") return fail(409, "This term is closed. Ask an administrator to reopen it with a reason before changing marks.");
      const parsed = schoolMarksInputSchema.safeParse(ctx.request.body);
      if (!parsed.success) return fail(422, "Enter valid scores once per student, with at most two decimal places.");
      const sections = await deps.directory.sectionsOfClass(assessment.classId);
      const rosters = await Promise.all(sections.map((section) => deps.directory.sectionRoster(section.sectionId)));
      const enrolled = new Set(rosters.flat().filter((row) => row.academicYear === assessment.academicYear).map((row) => row.studentId));
      if (parsed.data.entries.some((entry) => !enrolled.has(entry.studentId))) return fail(422, "Every student must be enrolled in this class for the assessment's academic year.");
      if (parsed.data.entries.some((entry) => entry.score > Number(assessment.maxScore))) return fail(422, "A score exceeds this assessment's maximum.");
      try {
        const saved = await deps.repo.saveMarks(assessment, parsed.data.entries, principal.id);
        return { status: 200, body: { marks: saved.marks.map(schoolMarkView) }, audit: { org: schoolAssessmentRef(assessment).org, resourceId: assessmentId, details: { termId: term.id, before: saved.before.map(schoolMarkView), after: saved.marks.map(schoolMarkView) } } };
      } catch (caught) { if (caught instanceof SchoolMarksError) return fail(caught.status, caught.message); throw caught; }
    };
  }
  return { "school-academics.class-setup": classSetup, "school-academics.assessments-list": list, "school-academics.assessment-create": create, "school-academics.marks-list": markHandler(false), "school-academics.marks-enter": markHandler(true) };
}
