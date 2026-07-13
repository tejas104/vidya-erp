import type { OrgPath, Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { NoticesRepo } from "./repo";
import type { NoticeRow } from "./db/schema";

export interface NoticesHandlerDeps {
  readonly repo: NoticesRepo;
  readonly directory: PeopleDirectory;
  readonly now?: () => Date;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}

/** Two org paths overlap when neither contradicts the other on a defined level.
 * A college-wide grant overlaps every path in its college; a class grant
 * overlaps its class and its department. Pure — unit-tested directly. */
export function orgOverlaps(a: OrgPath, b: OrgPath): boolean {
  if (a.collegeId !== b.collegeId) return false;
  if (a.departmentId !== undefined && b.departmentId !== undefined && a.departmentId !== b.departmentId) return false;
  if (a.classId !== undefined && b.classId !== undefined && a.classId !== b.classId) return false;
  return true;
}

function isStaff(principal: Principal): boolean {
  return principal.roles.some((role) => role !== "student");
}

function inCollege(principal: Principal, collegeId: string): boolean {
  return principal.grants.some((grant) => grant.org.collegeId === collegeId);
}

export function createNoticesHandlers(deps: NoticesHandlerDeps): Record<string, RouteHandler> {
  const now = deps.now ?? (() => new Date());

  /** Resolves an audience to its org path (for overlap checks) or null if the target vanished. */
  async function audiencePath(collegeId: string, audience: string): Promise<OrgPath | null> {
    if (audience.startsWith("department:")) return deps.directory.departmentPath(audience.slice("department:".length));
    if (audience.startsWith("class:")) return deps.directory.classPath(audience.slice("class:".length));
    return { collegeId };
  }

  async function audienceLabel(audience: string): Promise<string> {
    if (audience === "college") return "College-wide";
    if (audience === "staff") return "Staff";
    if (audience === "students") return "Students";
    const targetId = audience.slice(audience.indexOf(":") + 1);
    const names = await deps.directory.namesFor([targetId]);
    return names.get(targetId) ?? targetId;
  }

  async function view(row: NoticeRow) {
    return {
      id: row.id,
      collegeId: row.collegeId,
      audience: row.audience,
      audienceLabel: await audienceLabel(row.audience),
      title: row.title,
      body: row.body,
      publishAt: row.publishAt.toISOString(),
      expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  const create: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      collegeId: string; audience: string; title: string; body: string;
      publishAt?: string; expiresAt?: string;
    };
    if (!(await deps.directory.collegeExists(body.collegeId))) return notFound("no such college");
    if (!inCollege(principal, body.collegeId)) return denied();
    const target = await audiencePath(body.collegeId, body.audience);
    if (target === null || target.collegeId !== body.collegeId) {
      return notFound("no such department/class in this college");
    }
    const publishAt = body.publishAt === undefined ? now() : new Date(body.publishAt);
    const expiresAt = body.expiresAt === undefined ? null : new Date(body.expiresAt);
    if (expiresAt !== null && expiresAt <= publishAt) {
      return { status: 422, body: { message: "the notice would expire before it publishes" } };
    }
    const row = await deps.repo.create({
      collegeId: body.collegeId,
      audience: body.audience,
      title: body.title,
      body: body.body,
      publishAt,
      expiresAt,
      createdBy: principal.id,
    });
    return {
      status: 201,
      body: await view(row),
      audit: { resourceId: row.id, details: { audience: row.audience, title: row.title } },
    };
  };

  const list: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string };
    if (!inCollege(principal, query.collegeId)) return denied();
    const rows = await deps.repo.listForCollege(query.collegeId);
    return { status: 200, body: { notices: await Promise.all(rows.map((row) => view(row))) } };
  };

  const visible: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    // The caller's org positions: staff = session grants; student = the
    // identity link's enrollment (students hold no grants — self-scope only).
    let positions: OrgPath[] = principal.grants.map((grant) => grant.org);
    let studentRole = principal.roles.includes("student");
    if (positions.length === 0 && studentRole) {
      const own = await deps.directory.studentByIdentityUser(principal.id);
      if (own === null) return { status: 200, body: { notices: [] } };
      const position = await deps.directory.studentPosition(own.studentId);
      positions = position === null ? [{ collegeId: own.collegeId }] : [position];
    }
    if (positions.length === 0) return { status: 200, body: { notices: [] } };
    const staff = isStaff(principal);
    studentRole = principal.roles.includes("student");

    const results: NoticeRow[] = [];
    const seenColleges = new Set<string>();
    for (const position of positions) {
      if (seenColleges.has(position.collegeId)) continue;
      seenColleges.add(position.collegeId);
      const pathCache = new Map<string, OrgPath | null>();
      for (const row of await deps.repo.listLive(position.collegeId, now())) {
        if (row.audience === "staff" && !staff) continue;
        if (row.audience === "students" && !studentRole) continue;
        if (row.audience.startsWith("department:") || row.audience.startsWith("class:")) {
          let target = pathCache.get(row.audience);
          if (target === undefined) {
            target = await audiencePath(row.collegeId, row.audience);
            pathCache.set(row.audience, target);
          }
          if (target === null) continue;
          if (!positions.some((p) => orgOverlaps(p, target))) continue;
        }
        results.push(row);
      }
    }
    return { status: 200, body: { notices: await Promise.all(results.map((row) => view(row))) } };
  };

  const remove: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { noticeId: string };
    const row = await deps.repo.get(params.noticeId);
    if (row === null) return notFound("no such notice");
    if (!inCollege(principal, row.collegeId)) return denied();
    await deps.repo.delete(row.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: row.id, details: { title: row.title } } };
  };

  return {
    "notices.create": create,
    "notices.list": list,
    "notices.visible": visible,
    "notices.delete": remove,
  };
}
