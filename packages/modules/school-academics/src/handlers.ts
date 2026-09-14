import type { OrgPath, Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { DuplicateTermError, type TermsRepo } from "./repo";
import { termRef } from "./resource-refs";
import type { SchTermRow } from "./db/schema";

export interface SchoolAcademicsHandlerDeps {
  readonly repo: TermsRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied(message = "access denied") {
  return { status: 403, body: { message } };
}

function termView(row: SchTermRow) {
  return {
    id: row.id,
    collegeId: row.collegeId,
    // departmentId is deliberately NOT exposed: a school has no department
    // level, and the implicit row is one the API never renders (ADR-0023).
    name: row.name,
    academicYear: row.academicYear,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedBy: row.closedBy,
    closedReason: row.closedReason,
  };
}

export function createSchoolAcademicsHandlers(
  deps: SchoolAcademicsHandlerDeps,
): Record<string, RouteHandler> {
  /** Containment, decided by the SHARED matrix — never hand-rolled here. */
  function readAllowed(principal: Principal, org: OrgPath): boolean {
    return deps.scopeChecker.check(principal, "read", {
      module: "school-academics",
      resourceType: "term",
      org,
    }).granted;
  }

  /**
   * Term lifecycle writes. `grantAllows` (identity/src/core/scope-checker.ts,
   * HUMAN-OWNED) allowlists admin's write verbs to modules "identity" and
   * "people", so a new module gets no write authority from the matrix at all.
   * Same shape as fees' `writeAllowed` and leave's `decideAllowed`: the role
   * rule is this module's, and it only fires AFTER the read check has proven
   * org containment through the shared checker — tenancy stays fail-closed.
   */
  function writeAllowed(principal: Principal, org: OrgPath): boolean {
    if (!readAllowed(principal, org)) return false;
    return principal.roles.includes("admin");
  }

  const create: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      collegeId: string;
      name: string;
      academicYear: string;
      startsOn: string;
      endsOn: string;
    };
    // The org position is resolved server-side, never taken from the caller:
    // a school has exactly ONE department and it is implicit (ADR-0023).
    const departments = await deps.directory.departmentsOfCollege(body.collegeId);
    const departmentId = departments[0]?.departmentId;
    if (departmentId === undefined) return notFound("no such school");
    const position = { collegeId: body.collegeId, departmentId };
    if (!writeAllowed(principal, termRef(position).org)) return denied();
    if (body.endsOn < body.startsOn) {
      return { status: 422, body: { message: "the term would end before it starts" } };
    }
    try {
      const row = await deps.repo.create({ ...position, ...body });
      return {
        status: 201,
        body: termView(row),
        audit: {
          resourceId: row.id,
          details: { name: row.name, academicYear: row.academicYear, startsOn: row.startsOn, endsOn: row.endsOn },
        },
      };
    } catch (error) {
      if (error instanceof DuplicateTermError) {
        return { status: 409, body: { message: error.message } };
      }
      throw error;
    }
  };

  const list: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { academicYear?: string };
    const collegeIds = [...new Set(principal.grants.map((grant) => grant.org.collegeId))];
    const rows = await deps.repo.list(collegeIds, query.academicYear);
    // Row-filter through the shared checker (the marksEnter list variant):
    // a college-wide query is coarser than the grants behind it.
    const visible = rows.filter((row) => readAllowed(principal, termRef(row).org));
    return { status: 200, body: { terms: visible.map(termView) } };
  };

  /** close and reopen differ only in target status and whether a reason is required. */
  function transition(to: "open" | "closed"): RouteHandler {
    return async (ctx) => {
      const principal = ctx.principal as Principal;
      const params = ctx.request.params as { termId: string };
      const body = ctx.request.body as { reason?: string };
      // marksEnter order: load the stored record, 404 before 403, then scope.
      const term = await deps.repo.get(params.termId);
      if (term === null) return notFound("no such term");
      if (!writeAllowed(principal, termRef(term).org)) return denied();
      if (term.status === to) {
        return { status: 409, body: { message: `the term is already ${to}` } };
      }
      const reason = body.reason?.trim() ?? "";
      // Reopening is the audited exception, so it must say why. Belt and
      // braces with the route's zod schema: the rule lives here too, where
      // the state change actually happens.
      if (to === "open" && reason === "") {
        return { status: 422, body: { message: "reopening a term needs a reason" } };
      }
      const updated = await deps.repo.setStatus({
        id: term.id,
        status: to,
        actorId: principal.id,
        reason: reason === "" ? null : reason,
      });
      return {
        status: 200,
        body: termView(updated),
        audit: { resourceId: term.id, details: { status: to, reason: reason === "" ? null : reason } },
      };
    };
  }

  return {
    "school-academics.create": create,
    "school-academics.list": list,
    "school-academics.close": transition("closed"),
    "school-academics.reopen": transition("open"),
  };
}
