import type { AuditLogger, OrgPath, Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { LeaveRepo } from "./repo";
import type { LeaveRequestRow } from "./db/schema";

export interface LeaveHandlerDeps {
  readonly repo: LeaveRepo;
  readonly directory: PeopleDirectory;
  readonly audit: AuditLogger;
  readonly scopeChecker: ScopeChecker;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied(message = "access denied") {
  return { status: 403, body: { message } };
}

function orgFor(collegeId: string, departmentId: string | null): OrgPath {
  return departmentId === null ? { collegeId } : { collegeId, departmentId };
}

export function createLeaveHandlers(deps: LeaveHandlerDeps): Record<string, RouteHandler> {
  /** Org containment for a leave request — delegated to the shared matrix. */
  function readAllowed(principal: Principal, org: OrgPath): boolean {
    return deps.scopeChecker.check(principal, "read", { module: "leave", resourceType: "leave-request", org }).granted;
  }

  /**
   * Leave decide: the shared matrix grants "approve" to hod only
   * (identity/core/scope-checker.ts) — but principal/admin deciding leave is
   * a business rule this module owns, same shape as fees' admin short-circuit
   * (fees/handlers.ts `writeAllowed`): the role check only fires AFTER
   * containment is proven via the read check, so tenancy stays fail-closed.
   */
  function decideAllowed(principal: Principal, org: OrgPath): boolean {
    if (!readAllowed(principal, org)) return false;
    if (principal.roles.includes("principal") || principal.roles.includes("admin")) return true;
    return deps.scopeChecker.check(principal, "approve", { module: "leave", resourceType: "leave-request", org }).granted;
  }

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
    // A multi-grant principal (e.g. HOD in two colleges) must see pending
    // requests across every college they hold a grant in, not just the first.
    const collegeIds = [...new Set(principal.grants.map((grant) => grant.org.collegeId))];
    const rows: LeaveRequestRow[] = [];
    for (const collegeId of collegeIds) {
      const isCollegeWide = principal.grants.some(
        (grant) => grant.org.collegeId === collegeId && grant.org.departmentId === undefined,
      );
      const departmentIds = principal.grants
        .filter((grant) => grant.org.collegeId === collegeId && grant.org.departmentId !== undefined)
        .map((grant) => grant.org.departmentId!);
      rows.push(...(await deps.repo.listPending(collegeId, departmentIds, isCollegeWide)));
    }
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
    if (!decideAllowed(principal, orgFor(row.collegeId, row.departmentId))) return denied();
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
