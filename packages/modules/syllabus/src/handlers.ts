import { randomUUID } from "node:crypto";
import type { OrgPath, Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { DuplicateTitleError, coveragePct, type SyllabusRepo } from "./repo";
import type { SylTopicRow, SylUnitRow } from "./db/schema";

export interface SyllabusHandlerDeps {
  readonly repo: SyllabusRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}

function topicView(row: SylTopicRow) {
  return { id: row.id, title: row.title, position: row.position, taughtOn: row.taughtOn };
}
function unitView(row: SylUnitRow, subjectName: string, topics: readonly SylTopicRow[]) {
  const sorted = [...topics].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    classId: row.classId,
    subjectId: row.subjectId,
    subjectName,
    title: row.title,
    position: row.position,
    academicYear: row.academicYear,
    topics: sorted.map(topicView),
    coveragePct: coveragePct(sorted),
  };
}

export function createSyllabusHandlers(deps: SyllabusHandlerDeps): Record<string, RouteHandler> {
  /** Class path + subject-of-department validation (discriminated result). */
  type Target =
    | { ok: false; error: { status: number; body: { message: string } } }
    | { ok: true; path: OrgPath & { departmentId: string; classId: string } };
  async function resolveTarget(classId: string, subjectId: string): Promise<Target> {
    const path = await deps.directory.classPath(classId);
    if (path === null || path.departmentId === undefined || path.classId === undefined) {
      return { ok: false, error: notFound("no such class") };
    }
    const subjectDept = await deps.directory.subjectDepartment(subjectId);
    if (subjectDept === null) return { ok: false, error: notFound("no such subject") };
    if (subjectDept !== path.departmentId) {
      return { ok: false, error: { status: 422, body: { message: "subject does not belong to the class's department" } } };
    }
    return { ok: true, path: { ...path, departmentId: path.departmentId, classId: path.classId } };
  }

  /** Marks-style teacher authority: create/update on the subject record. */
  function teacherAllowed(principal: Principal, path: OrgPath, subjectId: string): boolean {
    return deps.scopeChecker.check(principal, "create", {
      module: "syllabus",
      resourceType: "syllabus-unit",
      org: path,
      subjectId,
    }).granted;
  }

  async function linkedStudent(principal: Principal) {
    return deps.directory.studentByIdentityUser(principal.id);
  }
  async function studentClass(principal: Principal): Promise<{ classId: string; studentId: string } | null> {
    const student = await linkedStudent(principal);
    if (student === null) return null;
    const position = await deps.directory.studentPosition(student.studentId);
    if (position?.classId === undefined) return { classId: "", studentId: student.studentId };
    return { classId: position.classId, studentId: student.studentId };
  }

  const unitCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string; subjectId: string; academicYear: string; title: string; position: number;
    };
    const target = await resolveTarget(body.classId, body.subjectId);
    if (!target.ok) return target.error;
    if (!teacherAllowed(principal, target.path, body.subjectId)) return denied();
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    try {
      const row = await deps.repo.createUnit({
        id: randomUUID(),
        collegeId: target.path.collegeId,
        departmentId: target.path.departmentId,
        classId: body.classId,
        subjectId: body.subjectId,
        teacherId: teacher?.teacherId ?? principal.id,
        academicYear: body.academicYear,
        title: body.title,
        position: body.position,
      });
      const names = await deps.directory.namesFor([row.subjectId]);
      return {
        status: 201,
        body: unitView(row, names.get(row.subjectId) ?? row.subjectId, []),
        audit: { resourceId: row.id, details: { classId: row.classId, subjectId: row.subjectId, title: row.title } },
      };
    } catch (error) {
      if (error instanceof DuplicateTitleError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const unitUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { unitId: string };
    const body = ctx.request.body as { title?: string; position?: number };
    const unit = await deps.repo.getUnit(params.unitId);
    if (unit === null) return notFound("no such unit");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    const updated = await deps.repo.updateUnit(unit.id, body);
    if (updated === null) return notFound("no such unit");
    const topics = await deps.repo.topicsForUnits([updated.id]);
    const names = await deps.directory.namesFor([updated.subjectId]);
    return {
      status: 200,
      body: unitView(updated, names.get(updated.subjectId) ?? updated.subjectId, topics),
      audit: { resourceId: updated.id, details: { ...body } },
    };
  };

  const unitDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { unitId: string };
    const unit = await deps.repo.getUnit(params.unitId);
    if (unit === null) return notFound("no such unit");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    await deps.repo.deleteUnit(unit.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: unit.id, details: { title: unit.title } } };
  };

  const topicCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { unitId: string };
    const body = ctx.request.body as { title: string; position: number };
    const unit = await deps.repo.getUnit(params.unitId);
    if (unit === null) return notFound("no such unit");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    const row = await deps.repo.createTopic({ id: randomUUID(), unitId: unit.id, title: body.title, position: body.position });
    return {
      status: 201,
      body: topicView(row),
      audit: { resourceId: row.id, details: { unitId: unit.id, title: row.title } },
    };
  };

  const topicUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { topicId: string };
    const body = ctx.request.body as { title?: string; position?: number };
    const topic = await deps.repo.getTopic(params.topicId);
    if (topic === null) return notFound("no such topic");
    const unit = await deps.repo.getUnit(topic.unitId);
    if (unit === null) return notFound("no such topic");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    const updated = await deps.repo.updateTopic(topic.id, body);
    if (updated === null) return notFound("no such topic");
    return { status: 200, body: topicView(updated), audit: { resourceId: updated.id, details: { ...body } } };
  };

  const topicDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { topicId: string };
    const topic = await deps.repo.getTopic(params.topicId);
    if (topic === null) return notFound("no such topic");
    const unit = await deps.repo.getUnit(topic.unitId);
    if (unit === null) return notFound("no such topic");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    await deps.repo.deleteTopic(topic.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: topic.id, details: { title: topic.title } } };
  };

  const topicCoverage: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { topicId: string };
    const body = ctx.request.body as { taughtOn: string | null };
    const topic = await deps.repo.getTopic(params.topicId);
    if (topic === null) return notFound("no such topic");
    const unit = await deps.repo.getUnit(topic.unitId);
    if (unit === null) return notFound("no such topic");
    const path: OrgPath = { collegeId: unit.collegeId, departmentId: unit.departmentId, classId: unit.classId };
    if (!teacherAllowed(principal, path, unit.subjectId)) return denied();
    const updated = await deps.repo.setCoverage(topic.id, body.taughtOn, body.taughtOn === null ? null : principal.id);
    if (updated === null) return notFound("no such topic");
    return {
      status: 200,
      body: topicView(updated),
      audit: { resourceId: updated.id, details: { taughtOn: body.taughtOn } },
    };
  };

  const classSyllabus: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.classPath(params.classId);
    if (path === null) return notFound("no such class");
    const units = await deps.repo.unitsForClass(params.classId, query.academicYear);
    const visible = units.filter((unit) =>
      deps.scopeChecker.check(principal, "read", {
        module: "syllabus",
        resourceType: "syllabus-unit",
        org: path,
        subjectId: unit.subjectId,
      }).granted,
    );
    const topics = await deps.repo.topicsForUnits(visible.map((unit) => unit.id));
    const topicsByUnit = new Map<string, SylTopicRow[]>();
    for (const topic of topics) {
      const list = topicsByUnit.get(topic.unitId) ?? [];
      list.push(topic);
      topicsByUnit.set(topic.unitId, list);
    }
    const names = await deps.directory.namesFor(visible.map((unit) => unit.subjectId));
    const sorted = [...visible].sort((a, b) => a.position - b.position);
    const views = sorted.map((unit) =>
      unitView(unit, names.get(unit.subjectId) ?? unit.subjectId, topicsByUnit.get(unit.id) ?? []),
    );
    return { status: 200, body: { units: views } };
  };

  const my: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { academicYear: string };
    const own = await studentClass(principal);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const units = own.classId === "" ? [] : await deps.repo.unitsForClass(own.classId, query.academicYear);
    const topics = await deps.repo.topicsForUnits(units.map((unit) => unit.id));
    const topicsByUnit = new Map<string, SylTopicRow[]>();
    for (const topic of topics) {
      const list = topicsByUnit.get(topic.unitId) ?? [];
      list.push(topic);
      topicsByUnit.set(topic.unitId, list);
    }
    const names = await deps.directory.namesFor(units.map((unit) => unit.subjectId));
    const bySubject = new Map<string, SylUnitRow[]>();
    for (const unit of units) {
      const list = bySubject.get(unit.subjectId) ?? [];
      list.push(unit);
      bySubject.set(unit.subjectId, list);
    }
    const subjects = [...bySubject.entries()].map(([subjectId, subjectUnits]) => {
      const sorted = [...subjectUnits].sort((a, b) => a.position - b.position);
      const allTopics = sorted.flatMap((unit) => topicsByUnit.get(unit.id) ?? []);
      const subjectName = names.get(subjectId) ?? subjectId;
      return {
        subjectId,
        subjectName,
        coveragePct: coveragePct(allTopics),
        units: sorted.map((unit) => unitView(unit, subjectName, topicsByUnit.get(unit.id) ?? [])),
      };
    });
    return { status: 200, body: { subjects } };
  };

  return {
    "syllabus.unit-create": unitCreate,
    "syllabus.unit-update": unitUpdate,
    "syllabus.unit-delete": unitDelete,
    "syllabus.topic-create": topicCreate,
    "syllabus.topic-update": topicUpdate,
    "syllabus.topic-delete": topicDelete,
    "syllabus.topic-coverage": topicCoverage,
    "syllabus.class-syllabus": classSyllabus,
    "syllabus.my": my,
  };
}
