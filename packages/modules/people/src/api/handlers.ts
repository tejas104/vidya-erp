import type {
  AccessAction,
  Principal,
  ResourceRef,
  RouteContext,
  RouteHandler,
  RouteResult,
  ScopeChecker,
} from "@vidya/platform";
import type { OrgService } from "../service/org-service";
import { PeopleService, UnknownReferenceError } from "../service/people-service";
import type { AssignmentsService } from "../service/assignments-service";
import type { ImportService } from "../service/import-service";
import { DuplicateCodeError, UnitInUseError, type OrgUnitType } from "../repo/org-repo";
import { DuplicateAssignmentError, DuplicatePersonError, type StudentStatus } from "../repo/people-repo";
import type {
  PplEnrollmentRow,
  PplImportRow,
  PplStudentRow,
  PplTeacherRow,
} from "../db/schema";
import type { importJobPayloadSchema } from "../definition";
import type { z } from "zod";

export interface PeopleHandlerDeps {
  readonly org: OrgService;
  readonly people: PeopleService;
  readonly assignments: AssignmentsService;
  readonly imports: ImportService;
  readonly scopeChecker: ScopeChecker;
  readonly enqueueImport: (payload: z.infer<typeof importJobPayloadSchema>) => Promise<void>;
}

function denied(ctx: RouteContext, reason: string): RouteResult {
  ctx.logger.warn({ reason }, "scope check denied");
  return { status: 403, body: { message: "access denied" } };
}

function notFound(): RouteResult {
  return { status: 404, body: { message: "not found" } };
}

/** The chokepoint: every record decision in this module flows through here. */
function checkScope(
  scopeChecker: ScopeChecker,
  ctx: RouteContext,
  principal: Principal,
  action: AccessAction,
  resource: ResourceRef,
): { ok: true } | { ok: false; result: RouteResult } {
  const decision = scopeChecker.check(principal, action, resource);
  if (!decision.granted) {
    return { ok: false, result: denied(ctx, decision.reason) };
  }
  return { ok: true };
}

function studentView(student: PplStudentRow, enrollment: PplEnrollmentRow | null) {
  return {
    id: student.id,
    collegeId: student.collegeId,
    admissionNo: student.admissionNo,
    fullName: student.fullName,
    status: student.status,
    identityUserId: student.identityUserId,
    phone: student.phone,
    guardianName: student.guardianName,
    guardianPhone: student.guardianPhone,
    dob: student.dob,
    enrollment:
      enrollment === null
        ? null
        : { sectionId: enrollment.sectionId, academicYear: enrollment.academicYear },
  };
}

function teacherView(teacher: PplTeacherRow) {
  return {
    id: teacher.id,
    collegeId: teacher.collegeId,
    staffNo: teacher.staffNo,
    fullName: teacher.fullName,
    status: teacher.status,
    identityUserId: teacher.identityUserId,
  };
}

function importView(row: PplImportRow) {
  return {
    id: row.id,
    kind: row.kind,
    collegeId: row.collegeId,
    status: row.status,
    dryRun: row.dryRun,
    totalRows: row.totalRows,
    okRows: row.okRows,
    errorRows: row.errorRows,
    errors: row.errors,
  };
}

function mapKnownErrors(error: unknown): RouteResult | null {
  if (error instanceof DuplicateCodeError || error instanceof DuplicatePersonError || error instanceof DuplicateAssignmentError) {
    return { status: 409, body: { message: error.message } };
  }
  if (error instanceof UnitInUseError) {
    return { status: 409, body: { message: error.message } };
  }
  if (error instanceof UnknownReferenceError) {
    return { status: 404, body: { message: error.message } };
  }
  return null;
}

export function createPeopleHandlers(deps: PeopleHandlerDeps): Record<string, RouteHandler> {
  const collegeList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const all = await deps.org.listColleges();
    const readable = all.filter(
      (college) =>
        deps.scopeChecker.check(principal, "read", {
          module: "people",
          resourceType: "college",
          org: { collegeId: college.id },
        }).granted,
    );
    return {
      status: 200,
      body: { colleges: readable.map(({ id, name, code }) => ({ id, name, code })) },
    };
  };

  const collegeTree: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { collegeId: string };
    const tree = await deps.org.getTree(params.collegeId);
    if (tree === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "college",
      org: { collegeId: params.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    return {
      status: 200,
      body: {
        college: { id: tree.college.id, name: tree.college.name, code: tree.college.code },
        departments: tree.departments.map((department) => ({
          id: department.id,
          collegeId: department.collegeId,
          name: department.name,
          code: department.code,
          classes: department.classes.map((classRow) => ({
            id: classRow.id,
            departmentId: classRow.departmentId,
            name: classRow.name,
            code: classRow.code,
            sections: classRow.sections.map((section) => ({
              id: section.id,
              classId: section.classId,
              name: section.name,
            })),
          })),
          subjects: department.subjects.map((subject) => ({
            id: subject.id,
            departmentId: subject.departmentId,
            name: subject.name,
            code: subject.code,
          })),
        })),
      },
    };
  };

  const departmentCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; name: string; code: string };
    if ((await deps.org.getCollege(body.collegeId)) === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "department",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.org.createDepartment(body);
      return {
        status: 201,
        body: { id: created.id, collegeId: created.collegeId, name: created.name, code: created.code },
        audit: { resourceId: created.id, details: { name: created.name, code: created.code, collegeId: created.collegeId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const classCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { departmentId: string; name: string; code: string };
    const parentPath = await deps.org.pathForUnit("department", body.departmentId);
    if (parentPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "class",
      org: parentPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.org.createClass(body);
      return {
        status: 201,
        body: { id: created.id, departmentId: created.departmentId, name: created.name, code: created.code },
        audit: { resourceId: created.id, details: { name: created.name, code: created.code, departmentId: created.departmentId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const sectionCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { classId: string; name: string };
    const parentPath = await deps.org.pathForUnit("class", body.classId);
    if (parentPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "section",
      org: parentPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.org.createSection(body);
      return {
        status: 201,
        body: { id: created.id, classId: created.classId, name: created.name },
        audit: { resourceId: created.id, details: { name: created.name, classId: created.classId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const subjectCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { departmentId: string; name: string; code: string };
    const parentPath = await deps.org.pathForUnit("department", body.departmentId);
    if (parentPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "subject",
      org: parentPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.org.createSubject(body);
      return {
        status: 201,
        body: { id: created.id, departmentId: created.departmentId, name: created.name, code: created.code },
        audit: { resourceId: created.id, details: { name: created.name, code: created.code, departmentId: created.departmentId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const orgRename: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { unitType: OrgUnitType; unitId: string };
    const body = ctx.request.body as { name: string };
    const path = await deps.org.pathForUnit(params.unitType, params.unitId);
    if (path === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: params.unitType,
      org: path,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const renamed = await deps.org.renameUnit(params.unitType, params.unitId, body.name);
    if (!renamed) {
      return notFound();
    }
    return {
      status: 200,
      body: { ok: true as const },
      audit: { resourceId: params.unitId, details: { unitType: params.unitType, name: body.name } },
    };
  };

  const orgDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { unitType: OrgUnitType; unitId: string };
    const path = await deps.org.pathForUnit(params.unitType, params.unitId);
    if (path === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "delete", {
      module: "people",
      resourceType: params.unitType,
      org: path,
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const deleted = await deps.org.deleteUnit(params.unitType, params.unitId);
      if (!deleted) {
        return notFound();
      }
    } catch (error) {
      const mapped = mapKnownErrors(error);
      if (mapped !== null) {
        return mapped;
      }
      throw error;
    }
    return {
      status: 200,
      body: { ok: true as const },
      audit: { resourceId: params.unitId, details: { unitType: params.unitType } },
    };
  };

  const studentCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; admissionNo: string; fullName: string };
    if ((await deps.org.getCollege(body.collegeId)) === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "student",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.people.createStudent(body);
      return {
        status: 201,
        body: studentView(created, null),
        audit: { resourceId: created.id, details: { admissionNo: created.admissionNo, collegeId: created.collegeId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const studentGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const student = await deps.people.getStudent(params.studentId);
    if (student === null) {
      return notFound();
    }
    const position = await deps.people.studentOrgPosition(student);
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "student",
      org: position,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const enrollment = await deps.people.latestActiveEnrollment(student.id);
    return { status: 200, body: studentView(student, enrollment) };
  };

  const studentUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const body = ctx.request.body as {
      fullName?: string;
      status?: StudentStatus;
      phone?: string | null;
      guardianName?: string | null;
      guardianPhone?: string | null;
      dob?: string | null;
    };
    const student = await deps.people.getStudent(params.studentId);
    if (student === null) {
      return notFound();
    }
    const position = await deps.people.studentOrgPosition(student);
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: "student",
      org: position,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const updated = await deps.people.updateStudent(params.studentId, body);
    if (updated === null) {
      return notFound();
    }
    const enrollment = await deps.people.latestActiveEnrollment(updated.id);
    return {
      status: 200,
      body: studentView(updated, enrollment),
      audit: {
        resourceId: updated.id,
        details: {
          before: { fullName: student.fullName, status: student.status },
          after: { fullName: updated.fullName, status: updated.status },
        },
      },
    };
  };

  const studentLinkIdentity: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const body = ctx.request.body as { identityUserId: string | null };
    const student = await deps.people.getStudent(params.studentId);
    if (student === null) {
      return notFound();
    }
    const position = await deps.people.studentOrgPosition(student);
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: "student",
      org: position,
    });
    if (!scope.ok) {
      return scope.result;
    }
    let updated;
    try {
      updated = await deps.people.linkStudentIdentity(params.studentId, body.identityUserId);
    } catch (error) {
      const code =
        (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23505") {
        return { status: 409, body: { message: "that sign-in is already linked to another student" } };
      }
      throw error;
    }
    if (updated === null) {
      return notFound();
    }
    const enrollment = await deps.people.latestActiveEnrollment(updated.id);
    return {
      status: 200,
      body: { student: studentView(updated, enrollment) },
      audit: {
        resourceId: updated.id,
        details: {
          before: { identityUserId: student.identityUserId },
          after: { identityUserId: updated.identityUserId },
        },
      },
    };
  };

  const studentEnroll: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const body = ctx.request.body as { sectionId: string; academicYear: string };
    const student = await deps.people.getStudent(params.studentId);
    if (student === null) {
      return notFound();
    }
    const targetPath = await deps.org.pathForSection(body.sectionId);
    if (targetPath === null) {
      return notFound();
    }
    const targetScope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "enrollment",
      org: targetPath,
    });
    if (!targetScope.ok) {
      return targetScope.result;
    }
    // Transfers also require authority over the enrollment being withdrawn.
    const previous = await deps.people.getActiveEnrollment(params.studentId, body.academicYear);
    if (previous !== null) {
      const sourcePath = await deps.org.pathForSection(previous.sectionId);
      if (sourcePath !== null) {
        const sourceScope = checkScope(deps.scopeChecker, ctx, principal, "update", {
          module: "people",
          resourceType: "enrollment",
          org: sourcePath,
        });
        if (!sourceScope.ok) {
          return sourceScope.result;
        }
      }
    }
    try {
      const result = await deps.people.enroll({
        studentId: params.studentId,
        sectionId: body.sectionId,
        academicYear: body.academicYear,
      });
      if (result === null) {
        return notFound();
      }
      return {
        status: 200,
        body: {
          enrollmentId: result.enrollment.id,
          previousEnrollmentId: result.previous?.id ?? null,
        },
        audit: {
          resourceId: result.enrollment.id,
          details: {
            studentId: params.studentId,
            sectionId: body.sectionId,
            academicYear: body.academicYear,
            previousEnrollmentId: result.previous?.id ?? null,
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const sectionRoster: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sectionId: string };
    const path = await deps.org.pathForSection(params.sectionId);
    if (path === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "roster",
      org: path,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const roster = await deps.people.roster(params.sectionId);
    return {
      status: 200,
      body: { students: roster.map((entry) => studentView(entry.student, entry.enrollment)) },
    };
  };

  const teacherCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; staffNo: string; fullName: string };
    if ((await deps.org.getCollege(body.collegeId)) === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "teacher",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.people.createTeacher(body);
      return {
        status: 201,
        body: teacherView(created),
        audit: { resourceId: created.id, details: { staffNo: created.staffNo, collegeId: created.collegeId } },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const teacherGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { teacherId: string };
    const teacher = await deps.people.getTeacher(params.teacherId);
    if (teacher === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "teacher",
      org: { collegeId: teacher.collegeId },
      ...(teacher.identityUserId !== null ? { ownerUserId: teacher.identityUserId } : {}),
    });
    if (!scope.ok) {
      return scope.result;
    }
    return { status: 200, body: teacherView(teacher) };
  };

  const teacherUpdate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { teacherId: string };
    const body = ctx.request.body as { fullName?: string; status?: "active" | "inactive" };
    const teacher = await deps.people.getTeacher(params.teacherId);
    if (teacher === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: "teacher",
      org: { collegeId: teacher.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const updated = await deps.people.updateTeacher(params.teacherId, body);
    if (updated === null) {
      return notFound();
    }
    // Status changes re-sync derived grants (inactive ⇒ removed; ADR-0015).
    const grants =
      body.status !== undefined && body.status !== teacher.status
        ? await deps.assignments.syncTeacher(params.teacherId)
        : { upserted: 0, removed: 0 };
    return {
      status: 200,
      body: teacherView(updated),
      audit: {
        resourceId: updated.id,
        details: {
          before: { fullName: teacher.fullName, status: teacher.status },
          after: { fullName: updated.fullName, status: updated.status },
          grants,
        },
      },
    };
  };

  const teacherLinkIdentity: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { teacherId: string };
    const body = ctx.request.body as { identityUserId: string | null };
    const teacher = await deps.people.getTeacher(params.teacherId);
    if (teacher === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "update", {
      module: "people",
      resourceType: "teacher",
      org: { collegeId: teacher.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const updated = await deps.people.linkTeacherIdentity(params.teacherId, body.identityUserId);
    if (updated === null) {
      return notFound();
    }
    const grants = await deps.assignments.syncTeacher(params.teacherId);
    return {
      status: 200,
      body: { teacher: teacherView(updated), grants },
      audit: {
        resourceId: updated.id,
        details: {
          before: { identityUserId: teacher.identityUserId },
          after: { identityUserId: updated.identityUserId },
          grants,
        },
      },
    };
  };

  const assignmentCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { teacherId: string };
    const body = ctx.request.body as {
      classId: string;
      subjectId?: string;
      kind: "subject_teacher" | "class_teacher";
      academicYear: string;
    };
    const teacher = await deps.people.getTeacher(params.teacherId);
    if (teacher === null) {
      return notFound();
    }
    const classPath = await deps.org.pathForClass(body.classId);
    if (classPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "teacher-assignment",
      org: classPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    try {
      const created = await deps.assignments.create({ teacherId: params.teacherId, ...body });
      if (created === null) {
        return notFound();
      }
      return {
        status: 201,
        body: {
          id: created.id,
          teacherId: created.teacherId,
          classId: created.classId,
          subjectId: created.subjectId,
          kind: created.kind,
          academicYear: created.academicYear,
        },
        audit: {
          resourceId: created.id,
          details: {
            teacherId: created.teacherId,
            classId: created.classId,
            subjectId: created.subjectId,
            kind: created.kind,
            academicYear: created.academicYear,
            grantDerived: teacher.identityUserId !== null && teacher.status === "active",
          },
        },
      };
    } catch (error) {
      return mapKnownErrors(error) ?? Promise.reject(error);
    }
  };

  const assignmentRemove: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { assignmentId: string };
    const assignment = await deps.assignments.getAssignment(params.assignmentId);
    if (assignment === null) {
      return notFound();
    }
    const classPath = await deps.org.pathForClass(assignment.classId);
    if (classPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "delete", {
      module: "people",
      resourceType: "teacher-assignment",
      org: classPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const removed = await deps.assignments.remove(params.assignmentId);
    if (!removed) {
      return notFound();
    }
    return {
      status: 200,
      body: { ok: true as const },
      audit: {
        resourceId: params.assignmentId,
        details: { teacherId: assignment.teacherId, classId: assignment.classId, kind: assignment.kind },
      },
    };
  };

  const classAssignments: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const classPath = await deps.org.pathForClass(params.classId);
    if (classPath === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "teacher-assignment",
      org: classPath,
    });
    if (!scope.ok) {
      return scope.result;
    }
    const assignments = await deps.assignments.assignmentsByClass(params.classId);
    return {
      status: 200,
      body: {
        assignments: assignments.map((assignment) => ({
          id: assignment.id,
          teacherId: assignment.teacherId,
          classId: assignment.classId,
          subjectId: assignment.subjectId,
          kind: assignment.kind,
          academicYear: assignment.academicYear,
        })),
      },
    };
  };

  const importCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      kind: "students" | "teachers";
      collegeId: string;
      academicYear?: string;
      dryRun: boolean;
      csv: string;
    };
    if ((await deps.org.getCollege(body.collegeId)) === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "create", {
      module: "people",
      resourceType: "import",
      org: { collegeId: body.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    const created = await deps.imports.createImport({
      kind: body.kind,
      collegeId: body.collegeId,
      ...(body.academicYear !== undefined ? { academicYear: body.academicYear } : {}),
      csv: body.csv,
      dryRun: body.dryRun,
      requestedBy: principal.id,
    });
    await deps.enqueueImport({ importId: created.id, source: "api" });
    return {
      status: 202,
      body: { importId: created.id },
      audit: {
        resourceId: created.id,
        details: { kind: body.kind, collegeId: body.collegeId, dryRun: body.dryRun },
      },
    };
  };

  const importGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { importId: string };
    const row = await deps.imports.getImport(params.importId);
    if (row === null) {
      return notFound();
    }
    const scope = checkScope(deps.scopeChecker, ctx, principal, "read", {
      module: "people",
      resourceType: "import",
      org: { collegeId: row.collegeId },
    });
    if (!scope.ok) {
      return scope.result;
    }
    return { status: 200, body: importView(row) };
  };

  return {
    "people.college-list": collegeList,
    "people.college-tree": collegeTree,
    "people.department-create": departmentCreate,
    "people.class-create": classCreate,
    "people.section-create": sectionCreate,
    "people.subject-create": subjectCreate,
    "people.org-rename": orgRename,
    "people.org-delete": orgDelete,
    "people.student-create": studentCreate,
    "people.student-get": studentGet,
    "people.student-update": studentUpdate,
    "people.student-link-identity": studentLinkIdentity,
    "people.student-enroll": studentEnroll,
    "people.section-roster": sectionRoster,
    "people.teacher-create": teacherCreate,
    "people.teacher-get": teacherGet,
    "people.teacher-update": teacherUpdate,
    "people.teacher-link-identity": teacherLinkIdentity,
    "people.assignment-create": assignmentCreate,
    "people.assignment-remove": assignmentRemove,
    "people.class-assignments": classAssignments,
    "people.import-create": importCreate,
    "people.import-get": importGet,
  };
}
