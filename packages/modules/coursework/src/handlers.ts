import { randomUUID } from "node:crypto";
import {
  ensureBucket,
  getObjectBytes,
  putObjectBytes,
  type ObjectStorageClient,
  type OrgPath,
  type Principal,
  type RouteHandler,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { DuplicateTitleError, type CourseworkRepo } from "./repo";
import type { CwkAssignmentRow, CwkMaterialRow } from "./db/schema";

export interface CourseworkHandlerDeps {
  readonly repo: CourseworkRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  readonly storage: { readonly client: ObjectStorageClient; readonly bucket: string };
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}

function assignmentView(row: CwkAssignmentRow, subjectName: string, submissions?: number) {
  return {
    id: row.id,
    classId: row.classId,
    subjectId: row.subjectId,
    subjectName,
    title: row.title,
    instructions: row.instructions,
    dueOn: row.dueOn,
    maxScore: row.maxScore === null ? null : Number(row.maxScore),
    academicYear: row.academicYear,
    ...(submissions !== undefined ? { submissions } : {}),
  };
}
function materialView(row: CwkMaterialRow, subjectName: string) {
  return {
    id: row.id,
    classId: row.classId,
    subjectId: row.subjectId,
    subjectName,
    title: row.title,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createCourseworkHandlers(deps: CourseworkHandlerDeps): Record<string, RouteHandler> {
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
      module: "coursework",
      resourceType: "assignment",
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

  const assignmentCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string; subjectId: string; title: string; instructions: string;
      dueOn: string; maxScore?: number; academicYear: string;
    };
    const target = await resolveTarget(body.classId, body.subjectId);
    if (!target.ok) return target.error;
    if (!teacherAllowed(principal, target.path, body.subjectId)) return denied();
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    try {
      const row = await deps.repo.createAssignment({
        collegeId: target.path.collegeId,
        departmentId: target.path.departmentId,
        classId: body.classId,
        subjectId: body.subjectId,
        teacherId: teacher?.teacherId ?? principal.id,
        title: body.title,
        instructions: body.instructions,
        dueOn: body.dueOn,
        maxScore: body.maxScore === undefined ? null : body.maxScore.toFixed(2),
        academicYear: body.academicYear,
      });
      const names = await deps.directory.namesFor([row.subjectId]);
      return {
        status: 201,
        body: assignmentView(row, names.get(row.subjectId) ?? row.subjectId),
        audit: { resourceId: row.id, details: { classId: row.classId, subjectId: row.subjectId, title: row.title } },
      };
    } catch (error) {
      if (error instanceof DuplicateTitleError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const classAssignments: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.classPath(params.classId);
    if (path === null) return notFound("no such class");
    const rows = await deps.repo.assignmentsForClass(params.classId, query.academicYear);
    const visible = rows.filter((row) =>
      deps.scopeChecker.check(principal, "read", {
        module: "coursework",
        resourceType: "assignment",
        org: path,
        subjectId: row.subjectId,
      }).granted,
    );
    const names = await deps.directory.namesFor(visible.map((row) => row.subjectId));
    const withCounts = await Promise.all(
      visible.map(async (row) =>
        assignmentView(row, names.get(row.subjectId) ?? row.subjectId, await deps.repo.submissionCount(row.id)),
      ),
    );
    return { status: 200, body: { assignments: withCounts } };
  };

  const assignmentDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assignmentId: string };
    const row = await deps.repo.getAssignment(params.assignmentId);
    if (row === null) return notFound("no such assignment");
    const path: OrgPath = { collegeId: row.collegeId, departmentId: row.departmentId, classId: row.classId };
    if (!teacherAllowed(principal, path, row.subjectId)) return denied();
    if ((await deps.repo.submissionCount(row.id)) > 0) {
      return { status: 409, body: { message: "submissions exist — deletion blocked" } };
    }
    await deps.repo.deleteAssignment(row.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: row.id, details: { title: row.title } } };
  };

  const submissions: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assignmentId: string };
    const row = await deps.repo.getAssignment(params.assignmentId);
    if (row === null) return notFound("no such assignment");
    const path: OrgPath = { collegeId: row.collegeId, departmentId: row.departmentId, classId: row.classId };
    if (!teacherAllowed(principal, path, row.subjectId)) return denied();
    const subs = await deps.repo.submissionsForAssignment(row.id);
    const names = await deps.directory.namesFor(subs.map((sub) => sub.studentId));
    return {
      status: 200,
      body: {
        submissions: subs.map((sub) => ({
          id: sub.id,
          studentId: sub.studentId,
          studentName: names.get(sub.studentId) ?? sub.studentId,
          body: sub.body,
          hasFile: sub.objectKey !== null,
          submittedAt: sub.submittedAt.toISOString(),
          score: sub.score === null ? null : Number(sub.score),
          feedback: sub.feedback,
        })),
      },
    };
  };

  const evaluate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { submissionId: string };
    const body = ctx.request.body as { score: number; feedback: string };
    const sub = await deps.repo.getSubmission(params.submissionId);
    if (sub === null) return notFound("no such submission");
    const assignment = await deps.repo.getAssignment(sub.assignmentId);
    if (assignment === null) return notFound("no such assignment");
    const path: OrgPath = { collegeId: assignment.collegeId, departmentId: assignment.departmentId, classId: assignment.classId };
    if (!teacherAllowed(principal, path, assignment.subjectId)) return denied();
    if (assignment.maxScore !== null && body.score > Number(assignment.maxScore)) {
      return { status: 422, body: { message: "score exceeds the assignment's maxScore" } };
    }
    const updated = await deps.repo.evaluate(sub.id, {
      score: body.score.toFixed(2),
      feedback: body.feedback,
      evaluatedBy: principal.id,
    });
    if (updated === null) return notFound("no such submission");
    const names = await deps.directory.namesFor([updated.studentId]);
    return {
      status: 200,
      body: {
        id: updated.id,
        studentId: updated.studentId,
        studentName: names.get(updated.studentId) ?? updated.studentId,
        body: updated.body,
        hasFile: updated.objectKey !== null,
        submittedAt: updated.submittedAt.toISOString(),
        score: updated.score === null ? null : Number(updated.score),
        feedback: updated.feedback,
      },
      audit: {
        resourceId: updated.id,
        details: { assignmentId: assignment.id, studentId: updated.studentId, score: body.score },
      },
    };
  };

  const materialUpload: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string; subjectId: string; title: string; contentType: string; dataBase64: string; academicYear: string;
    };
    const target = await resolveTarget(body.classId, body.subjectId);
    if (!target.ok) return target.error;
    if (!teacherAllowed(principal, target.path, body.subjectId)) return denied();
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    const bytes = Buffer.from(body.dataBase64, "base64");
    const key = `coursework/${target.path.collegeId}/materials/${randomUUID()}`;
    await ensureBucket(deps.storage.client, deps.storage.bucket);
    await putObjectBytes(deps.storage.client, deps.storage.bucket, key, bytes, body.contentType);
    const row = await deps.repo.createMaterial({
      collegeId: target.path.collegeId,
      departmentId: target.path.departmentId,
      classId: body.classId,
      subjectId: body.subjectId,
      teacherId: teacher?.teacherId ?? principal.id,
      title: body.title,
      objectKey: key,
      contentType: body.contentType,
      sizeBytes: bytes.length,
      academicYear: body.academicYear,
    });
    const names = await deps.directory.namesFor([row.subjectId]);
    return {
      status: 201,
      body: materialView(row, names.get(row.subjectId) ?? row.subjectId),
      audit: { resourceId: row.id, details: { title: row.title, sizeBytes: row.sizeBytes } },
    };
  };

  const classMaterials: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.classPath(params.classId);
    if (path === null) return notFound("no such class");
    const rows = await deps.repo.materialsForClass(params.classId, query.academicYear);
    const visible = rows.filter((row) =>
      deps.scopeChecker.check(principal, "read", {
        module: "coursework",
        resourceType: "material",
        org: path,
        subjectId: row.subjectId,
      }).granted,
    );
    const names = await deps.directory.namesFor(visible.map((row) => row.subjectId));
    return {
      status: 200,
      body: { materials: visible.map((row) => materialView(row, names.get(row.subjectId) ?? row.subjectId)) },
    };
  };

  const materialDownload: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { materialId: string };
    const row = await deps.repo.getMaterial(params.materialId);
    if (row === null) return notFound("no such material");
    let allowed = deps.scopeChecker.check(principal, "read", {
      module: "coursework",
      resourceType: "material",
      org: { collegeId: row.collegeId, departmentId: row.departmentId, classId: row.classId },
      subjectId: row.subjectId,
    }).granted;
    if (!allowed && principal.roles.includes("student")) {
      const own = await studentClass(principal);
      allowed = own !== null && own.classId === row.classId;
    }
    if (!allowed) {
      ctx.logger.warn({ materialId: row.id }, "material download denied");
      return denied();
    }
    const bytes = await getObjectBytes(deps.storage.client, deps.storage.bucket, row.objectKey);
    return {
      status: 200,
      body: bytes,
      contentType: row.contentType,
      headers: {
        "content-disposition": `attachment; filename="${row.title.replace(/[^\w. -]/g, "_")}"`,
        "cache-control": "no-store",
      },
    };
  };

  const myAssignments: RouteHandler = async (ctx) => {
    const own = await studentClass(ctx.principal as Principal);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const query = ctx.request.query as { academicYear: string };
    const rows = own.classId === "" ? [] : await deps.repo.assignmentsForClass(own.classId, query.academicYear);
    const names = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    const assignments = await Promise.all(
      rows.map(async (row) => {
        const mine = await deps.repo.submissionFor(row.id, own.studentId);
        return {
          ...assignmentView(row, names.get(row.subjectId) ?? row.subjectId),
          mySubmission:
            mine === null
              ? null
              : {
                  submittedAt: mine.submittedAt.toISOString(),
                  score: mine.score === null ? null : Number(mine.score),
                  feedback: mine.feedback,
                },
        };
      }),
    );
    return { status: 200, body: { assignments } };
  };

  const submit: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const own = await studentClass(principal);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const params = ctx.request.params as { assignmentId: string };
    const body = ctx.request.body as { body: string; contentType?: string; dataBase64?: string };
    const assignment = await deps.repo.getAssignment(params.assignmentId);
    if (assignment === null || assignment.classId !== own.classId) {
      return notFound("no such assignment in your class");
    }
    let objectKey: string | null = null;
    if (body.dataBase64 !== undefined && body.dataBase64 !== "") {
      const bytes = Buffer.from(body.dataBase64, "base64");
      objectKey = `coursework/${assignment.collegeId}/submissions/${assignment.id}/${own.studentId}`;
      await ensureBucket(deps.storage.client, deps.storage.bucket);
      await putObjectBytes(deps.storage.client, deps.storage.bucket, objectKey, bytes, body.contentType ?? "application/octet-stream");
    }
    const saved = await deps.repo.upsertSubmission({
      assignmentId: assignment.id,
      studentId: own.studentId,
      body: body.body,
      objectKey,
    });
    if (saved === null) {
      return { status: 409, body: { message: "already evaluated — resubmission is locked" } };
    }
    return {
      status: 200,
      body: { ok: true as const, submittedAt: saved.submittedAt.toISOString() },
      audit: { resourceId: saved.id, details: { assignmentId: assignment.id } },
    };
  };

  const myMaterials: RouteHandler = async (ctx) => {
    const own = await studentClass(ctx.principal as Principal);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const query = ctx.request.query as { academicYear: string };
    const rows = own.classId === "" ? [] : await deps.repo.materialsForClass(own.classId, query.academicYear);
    const names = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    return {
      status: 200,
      body: { materials: rows.map((row) => materialView(row, names.get(row.subjectId) ?? row.subjectId)) },
    };
  };

  return {
    "coursework.assignment-create": assignmentCreate,
    "coursework.class-assignments": classAssignments,
    "coursework.assignment-delete": assignmentDelete,
    "coursework.submissions": submissions,
    "coursework.evaluate": evaluate,
    "coursework.material-upload": materialUpload,
    "coursework.class-materials": classMaterials,
    "coursework.material-download": materialDownload,
    "coursework.my-assignments": myAssignments,
    "coursework.submit": submit,
    "coursework.my-materials": myMaterials,
  };
}
