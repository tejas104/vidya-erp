import type { AuditLogger, Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { LeaveRepo } from "./repo";
import type { LeaveRequestRow } from "./db/schema";

export interface LeaveHandlerDeps {
  readonly repo: LeaveRepo;
  readonly directory: PeopleDirectory;
  readonly audit: AuditLogger;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied(message = "access denied") {
  return { status: 403, body: { message } };
}

/** Can this caller decide a request in `departmentId`/`collegeId`?
 * A principal/college grant (no departmentId) covers the whole college; an HOD
 * grant covers a matching department. Null-department requests need a college grant. */
function covers(principal: Principal, collegeId: string, departmentId: string | null): boolean {
  return principal.grants.some((grant) => {
    if (grant.org.collegeId !== collegeId) return false;
    if (grant.org.departmentId === undefined) return true; // college-wide (principal/admin)
    return departmentId !== null && grant.org.departmentId === departmentId;
  });
}

export function createLeaveHandlers(deps: LeaveHandlerDeps): Record<string, RouteHandler> {
  async function view(row: LeaveRequestRow, name?: string) {
    const teacherName = name ?? (await deps.directory.namesFor([row.teacherId])).get(row.teacherId) ?? row.teacherId;
    return {
      id: row.id,
      collegeId: row.collegeId,
      departmentId: row.departmentId,
      teacherId: row.teacherId,
      teacherName,
      fromOn: row.fromOn,
      toOn: row.toOn,
      kind: row.kind,
      reason: row.reason,
      status: row.status,
      decisionNote: row.decisionNote,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    };
  }

  async function viewAll(rows: LeaveRequestRow[]) {
    const names = await deps.directory.namesFor(rows.map((r) => r.teacherId));
    return Promise.all(rows.map((r) => view(r, names.get(r.teacherId) ?? r.teacherId)));
  }

  const apply: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      fromOn: string; toOn: string; kind: string; reason: string; departmentId?: string;
    };
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    if (teacher === null) return notFound("this sign-in is not linked to a staff record");
    if (body.toOn < body.fromOn) {
      return { status: 422, body: { message: "the leave would end before it starts" } };
    }
    const departments = await deps.directory.teacherDepartments(teacher.teacherId);
    let departmentId: string | null;
    if (departments.length === 0) {
      departmentId = null; // college-level: the principal decides
    } else if (departments.length === 1) {
      departmentId = departments[0]!;
    } else {
      if (body.departmentId === undefined || !departments.includes(body.departmentId)) {
        return { status: 422, body: { message: "choose one of your departments" } };
      }
      departmentId = body.departmentId;
    }
    const row = await deps.repo.create({
      collegeId: teacher.collegeId,
      departmentId,
      teacherId: teacher.teacherId,
      fromOn: body.fromOn,
      toOn: body.toOn,
      kind: body.kind,
      reason: body.reason,
    });
    return {
      status: 201,
      body: await view(row, teacher.fullName),
      audit: { resourceId: row.id, details: { kind: row.kind, fromOn: row.fromOn, toOn: row.toOn } },
    };
  };

  const myRequests: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    if (teacher === null) return notFound("this sign-in is not linked to a staff record");
    const rows = await deps.repo.listForTeacher(teacher.teacherId);
    return { status: 200, body: { requests: await viewAll(rows) } };
  };

  const pendingForMe: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    // The caller's college(s) and the departments they hold an HOD grant on.
    const collegeId = principal.grants[0]?.org.collegeId;
    if (collegeId === undefined) return { status: 200, body: { requests: [] } };
    const isCollegeWide = principal.grants.some(
      (grant) => grant.org.collegeId === collegeId && grant.org.departmentId === undefined,
    );
    const departmentIds = principal.grants
      .filter((grant) => grant.org.collegeId === collegeId && grant.org.departmentId !== undefined)
      .map((grant) => grant.org.departmentId!);
    const rows = await deps.repo.listPending(collegeId, departmentIds, isCollegeWide);
    return { status: 200, body: { requests: await viewAll(rows) } };
  };

  const decide: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { requestId: string };
    const body = ctx.request.body as { status: "approved" | "rejected"; note?: string };
    const row = await deps.repo.get(params.requestId);
    if (row === null) return notFound("no such request");
    if (row.teacherId && (await deps.directory.teacherByIdentityUser(principal.id))?.teacherId === row.teacherId) {
      return denied("you cannot decide your own leave");
    }
    if (!covers(principal, row.collegeId, row.departmentId)) return denied();
    if (row.status !== "pending") return { status: 409, body: { message: "already decided" } };
    const note = body.note?.trim() ?? "";
    if (body.status === "rejected" && note === "") {
      return { status: 422, body: { message: "a rejection needs a note" } };
    }
    const updated = await deps.repo.decide({
      id: row.id,
      status: body.status,
      decidedBy: principal.id,
      decisionNote: note === "" ? null : note,
    });
    return {
      status: 200,
      body: await view(updated),
      audit: { resourceId: row.id, details: { status: body.status } },
    };
  };

  return {
    "leave.apply": apply,
    "leave.my-requests": myRequests,
    "leave.pending-for-me": pendingForMe,
    "leave.decide": decide,
  };
}
