import type { OrgPath, Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { sgpa, type Band } from "./gpa";
import { createResultsComputer, type SubjectResultView } from "./compute";
import {
  AlreadyPublishedError,
  DuplicateScaleError,
  ScaleInUseError,
  type ResultsRepo,
} from "./repo";
import type { GradeScaleRow, PublicationRow } from "./db/schema";

export interface ResultsHandlerDeps {
  readonly repo: ResultsRepo;
  readonly directory: PeopleDirectory;
  readonly marks: AcademicsReadModel;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}
function noCredits() {
  return { status: 422, body: { message: "no credits set for this class/year — set credits first" } };
}

function inCollege(principal: Principal, collegeId: string): boolean {
  return principal.grants.some((grant) => grant.org.collegeId === collegeId);
}

export function createResultsHandlers(deps: ResultsHandlerDeps): Record<string, RouteHandler> {
  const computer = createResultsComputer(deps);

  async function scaleView(row: GradeScaleRow) {
    return {
      id: row.id,
      collegeId: row.collegeId,
      name: row.name,
      bands: row.bands,
      locked: await deps.repo.scaleInUse(row.id),
    };
  }

  function publicationView(row: PublicationRow) {
    return {
      id: row.id,
      collegeId: row.collegeId,
      classId: row.classId,
      academicYear: row.academicYear,
      term: row.term,
      scaleId: row.scaleId,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: row.publishedBy,
    };
  }

  /** Shared 404/403/422 gauntlet for preview + publish. */
  async function resolveClassAndScale(
    principal: Principal,
    classId: string,
    academicYear: string,
    scaleId: string,
  ): Promise<
    | { ok: true; position: OrgPath & { departmentId: string }; scale: GradeScaleRow; creditBySubject: Map<string, number> }
    | { ok: false; response: { status: number; body: { message: string } } }
  > {
    const position = await deps.directory.classPath(classId);
    if (position === null) return { ok: false, response: notFound("no such class") };
    if (!inCollege(principal, position.collegeId)) return { ok: false, response: denied() };
    const scale = await deps.repo.getScale(scaleId);
    if (scale === null || scale.collegeId !== position.collegeId) {
      return { ok: false, response: notFound("no such scale") };
    }
    const credits = await deps.repo.creditsFor(classId, academicYear);
    if (credits.length === 0) return { ok: false, response: noCredits() };
    return {
      ok: true,
      position: position as OrgPath & { departmentId: string },
      scale,
      creditBySubject: new Map(credits.map((row) => [row.subjectId, row.credits])),
    };
  }

  const scaleCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; name: string; bands: Band[] };
    if (!(await deps.directory.collegeExists(body.collegeId))) return notFound("no such college");
    if (!inCollege(principal, body.collegeId)) return denied();
    try {
      const row = await deps.repo.createScale(body.collegeId, body.name, body.bands);
      return { status: 201, body: await scaleView(row), audit: { resourceId: row.id, details: { name: row.name } } };
    } catch (error) {
      if (error instanceof DuplicateScaleError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const scaleList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string };
    if (!inCollege(principal, query.collegeId)) return denied();
    const rows = await deps.repo.listScales(query.collegeId);
    return { status: 200, body: { scales: await Promise.all(rows.map((row) => scaleView(row))) } };
  };

  const scaleUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { scaleId: string };
    const body = ctx.request.body as { name?: string; bands?: Band[] };
    const existing = await deps.repo.getScale(params.scaleId);
    if (existing === null) return notFound("no such scale");
    if (!inCollege(principal, existing.collegeId)) return denied();
    try {
      const row = await deps.repo.updateScale(params.scaleId, body);
      if (row === null) return notFound("no such scale");
      return { status: 200, body: await scaleView(row), audit: { resourceId: row.id, details: { name: row.name } } };
    } catch (error) {
      if (error instanceof ScaleInUseError || error instanceof DuplicateScaleError) {
        return { status: 409, body: { message: error.message } };
      }
      throw error;
    }
  };

  const scaleDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { scaleId: string };
    const existing = await deps.repo.getScale(params.scaleId);
    if (existing === null) return notFound("no such scale");
    if (!inCollege(principal, existing.collegeId)) return denied();
    try {
      if (await deps.repo.scaleInUse(params.scaleId)) throw new ScaleInUseError();
      await deps.repo.deleteScale(params.scaleId);
      return { status: 200, body: { ok: true as const }, audit: { resourceId: existing.id, details: { name: existing.name } } };
    } catch (error) {
      if (error instanceof ScaleInUseError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const creditsGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const position = await deps.directory.classPath(params.classId);
    if (position === null) return notFound("no such class");
    if (!inCollege(principal, position.collegeId)) return denied();
    const rows = await deps.repo.creditsFor(params.classId, query.academicYear);
    const names = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    return {
      status: 200,
      body: {
        credits: rows.map((row) => ({
          subjectId: row.subjectId,
          subjectName: names.get(row.subjectId) ?? row.subjectId,
          credits: row.credits,
        })),
      },
    };
  };

  const creditsSet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string;
      academicYear: string;
      entries: { subjectId: string; credits: number }[];
    };
    const position = await deps.directory.classPath(body.classId);
    if (position === null || position.departmentId === undefined) return notFound("no such class");
    if (!inCollege(principal, position.collegeId)) return denied();
    for (const entry of body.entries) {
      const departmentId = await deps.directory.subjectDepartment(entry.subjectId);
      if (departmentId === null || departmentId !== position.departmentId) {
        return notFound(`no such subject in this class's department: ${entry.subjectId}`);
      }
    }
    const rows = await deps.repo.replaceCredits(
      { collegeId: position.collegeId, departmentId: position.departmentId, classId: body.classId },
      body.academicYear,
      body.entries,
    );
    const names = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    return {
      status: 200,
      body: {
        credits: rows.map((row) => ({
          subjectId: row.subjectId,
          subjectName: names.get(row.subjectId) ?? row.subjectId,
          credits: row.credits,
        })),
      },
      audit: {
        resourceId: body.classId,
        details: { academicYear: body.academicYear, entries: body.entries },
      },
    };
  };

  const classResults: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string; scaleId: string };
    const resolved = await resolveClassAndScale(principal, params.classId, query.academicYear, query.scaleId);
    if (!resolved.ok) return resolved.response;
    const { scale, creditBySubject } = resolved;

    const subjectNames = await deps.directory.namesFor([...creditBySubject.keys()]);
    const studentIds = await computer.classRoster(params.classId, query.academicYear);
    const briefs = await deps.directory.studentsBrief(studentIds);
    // ponytail: N studentMarks queries — one aggregate query if class sizes ever hurt.
    const computed: { studentId: string; studentName: string; admissionNo: string; subjects: SubjectResultView[]; sgpa: number }[] = [];
    for (const studentId of studentIds) {
      const subjects = await computer.subjectResults(studentId, params.classId, query.academicYear, creditBySubject, subjectNames, scale.bands);
      const value = sgpa(subjects);
      if (value === null) continue; // no marks at all — absent from the ranked preview
      const brief = briefs.get(studentId);
      computed.push({
        studentId,
        studentName: brief?.fullName ?? studentId,
        admissionNo: brief?.admissionNo ?? "",
        subjects,
        sgpa: value,
      });
    }
    computed.sort((a, b) => b.sgpa - a.sgpa || a.studentName.localeCompare(b.studentName));
    const rows = computed.map((row) => ({
      ...row,
      rank: 1 + computed.filter((other) => other.sgpa > row.sgpa).length,
    }));
    const publications = await deps.repo.publicationsForClass(params.classId, query.academicYear);
    return { status: 200, body: { rows, publications: publications.map(publicationView) } };
  };

  const publish: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { classId: string; academicYear: string; term: string; scaleId: string };
    const resolved = await resolveClassAndScale(principal, body.classId, body.academicYear, body.scaleId);
    if (!resolved.ok) return resolved.response;
    try {
      const row = await deps.repo.publish({
        collegeId: resolved.position.collegeId,
        departmentId: resolved.position.departmentId,
        classId: body.classId,
        academicYear: body.academicYear,
        term: body.term.trim(),
        scaleId: body.scaleId,
        publishedBy: principal.id,
      });
      return {
        status: 201,
        body: publicationView(row),
        audit: { resourceId: row.id, details: { classId: row.classId, academicYear: row.academicYear, term: row.term } },
      };
    } catch (error) {
      if (error instanceof AlreadyPublishedError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const myResults: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const own = await deps.directory.studentByIdentityUser(principal.id);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const position = await deps.directory.studentPosition(own.studentId);
    const classId = position?.classId;
    if (classId === undefined) return { status: 200, body: { terms: [], cgpa: null } };

    // The publication gate: only published terms are computed — an unpublished
    // term simply does not exist for the student.
    const { terms, cgpa } = await computer.publishedTerms(own.studentId, classId);
    return { status: 200, body: { terms, cgpa } };
  };

  return {
    "results.scale-create": scaleCreate,
    "results.scale-list": scaleList,
    "results.scale-update": scaleUpdate,
    "results.scale-delete": scaleDelete,
    "results.credits-get": creditsGet,
    "results.credits-set": creditsSet,
    "results.class-results": classResults,
    "results.publish": publish,
    "results.my-results": myResults,
  };
}
