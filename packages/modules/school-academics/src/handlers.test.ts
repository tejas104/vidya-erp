import { describe, expect, it } from "vitest";
import type { OrgPath, Principal, ScopeChecker, ScopeDecision } from "@vidya/platform";
import { createSchoolAcademicsHandlers } from "./handlers";
import type { NewTerm, TermsRepo } from "./repo";
import type { SchTermRow } from "./db/schema";

/**
 * Faithful-enough fake of the real matrix: org containment is the IDENTICAL
 * prefix rule to identity/core/scope-checker.ts `covers()`, and "read" is
 * granted to any covering grant — the only action this module asks the
 * shared checker for (the admin role rule lives in handlers.ts, and only
 * fires after containment is proven).
 */
function fakeScopeChecker(): ScopeChecker {
  function covers(g: OrgPath, r: OrgPath): boolean {
    return (
      g.collegeId === r.collegeId &&
      (g.departmentId === undefined || g.departmentId === r.departmentId) &&
      (g.classId === undefined || g.classId === r.classId) &&
      (g.sectionId === undefined || g.sectionId === r.sectionId)
    );
  }
  return {
    check(caller, action, resource): ScopeDecision {
      for (const grant of caller.grants) {
        if (covers(grant.org, resource.org) && action === "read") {
          return { granted: true, reason: "fake-allow" };
        }
      }
      return { granted: false, reason: "fake-deny" };
    },
  };
}

const SCHOOL = "col_school";
const OTHER_SCHOOL = "col_other";
const DEPT = "dep_implicit";
const OTHER_DEPT = "dep_other";

function fakeDirectory() {
  return {
    departmentsOfCollege: async (collegeId: string) =>
      collegeId === SCHOOL
        ? [{ departmentId: DEPT, name: "__SCHOOL__" }]
        : collegeId === OTHER_SCHOOL
          ? [{ departmentId: OTHER_DEPT, name: "__SCHOOL__" }]
          : [],
  } as never;
}

function row(over: Partial<SchTermRow> = {}): SchTermRow {
  return {
    id: "trm_1",
    collegeId: SCHOOL,
    departmentId: DEPT,
    name: "Term 1",
    academicYear: "2026-27",
    startsOn: "2026-04-01",
    endsOn: "2026-09-30",
    status: "open",
    closedAt: null,
    closedBy: null,
    closedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function fakeRepo(seed: SchTermRow[] = []): TermsRepo & { rows: SchTermRow[] } {
  const rows = [...seed];
  return {
    rows,
    async create(input: NewTerm) {
      const created = row({ id: `trm_${rows.length + 1}`, ...input });
      rows.push(created);
      return created;
    },
    async get(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async list(collegeIds, academicYear) {
      return rows.filter(
        (r) =>
          collegeIds.includes(r.collegeId) &&
          (academicYear === undefined || r.academicYear === academicYear),
      );
    },
    async setStatus(input) {
      const target = rows.find((r) => r.id === input.id)!;
      target.status = input.status;
      target.closedAt = new Date();
      target.closedBy = input.actorId;
      target.closedReason = input.reason;
      return target;
    },
  };
}

function principal(over: Partial<Principal>): Principal {
  return { id: "u_admin", roles: [], scopes: [], grants: [], ...over } as Principal;
}

const schoolAdmin = principal({
  roles: ["admin"],
  grants: [{ role: "admin", org: { collegeId: SCHOOL } }],
});
/** Admin of a DIFFERENT school: the role is right, the containment is not. */
const foreignAdmin = principal({
  id: "u_foreign",
  roles: ["admin"],
  grants: [{ role: "admin", org: { collegeId: OTHER_SCHOOL } }],
});

function ctx(p: Principal, request: { body?: unknown; params?: unknown; query?: unknown }) {
  return { principal: p, request } as never;
}

function handlers(repo: TermsRepo) {
  return createSchoolAcademicsHandlers({
    repo,
    directory: fakeDirectory(),
    scopeChecker: fakeScopeChecker(),
  });
}

const CREATE_BODY = {
  collegeId: SCHOOL,
  name: "Term 1",
  academicYear: "2026-27",
  startsOn: "2026-04-01",
  endsOn: "2026-09-30",
};

describe("school-academics.create", () => {
  it("creates an open term and denormalizes the implicit department", async () => {
    const repo = fakeRepo();
    const result = await handlers(repo)["school-academics.create"]!(
      ctx(schoolAdmin, { body: CREATE_BODY }),
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ name: "Term 1", status: "open", startsOn: "2026-04-01" });
    // The API never renders the department level (ADR-0023) ...
    expect(result.body).not.toHaveProperty("departmentId");
    // ... but the row carries it, so scope checks need no cross-module lookup.
    expect(repo.rows[0]!.departmentId).toBe(DEPT);
    expect(result.audit?.resourceId).toBe(repo.rows[0]!.id);
  });

  it("422s a term that would end before it starts", async () => {
    const repo = fakeRepo();
    const result = await handlers(repo)["school-academics.create"]!(
      ctx(schoolAdmin, { body: { ...CREATE_BODY, endsOn: "2026-03-31" } }),
    );
    expect(result.status).toBe(422);
    expect(repo.rows).toHaveLength(0);
  });

  it("404s an unknown school before anything is written", async () => {
    const repo = fakeRepo();
    const result = await handlers(repo)["school-academics.create"]!(
      ctx(schoolAdmin, { body: { ...CREATE_BODY, collegeId: "col_nope" } }),
    );
    expect(result.status).toBe(404);
    expect(repo.rows).toHaveLength(0);
  });
});

describe("school-academics.list", () => {
  it("returns the caller's own school's terms", async () => {
    const repo = fakeRepo([row(), row({ id: "trm_2", name: "Term 2" })]);
    const result = await handlers(repo)["school-academics.list"]!(ctx(schoolAdmin, { query: {} }));

    expect(result.status).toBe(200);
    expect((result.body as { terms: { name: string }[] }).terms.map((t) => t.name)).toEqual([
      "Term 1",
      "Term 2",
    ]);
  });

  it("filters by academicYear", async () => {
    const repo = fakeRepo([row(), row({ id: "trm_2", academicYear: "2027-28" })]);
    const result = await handlers(repo)["school-academics.list"]!(
      ctx(schoolAdmin, { query: { academicYear: "2027-28" } }),
    );
    expect((result.body as { terms: { id: string }[] }).terms.map((t) => t.id)).toEqual(["trm_2"]);
  });

  it("row-filters out a term the caller holds no covering grant for", async () => {
    // The repo is deliberately made to leak the foreign row, so the assertion
    // is about the handler's scope filter rather than about the SQL.
    const repo = fakeRepo([row({ id: "trm_x", collegeId: OTHER_SCHOOL, departmentId: OTHER_DEPT })]);
    repo.list = async () => repo.rows;
    const result = await handlers(repo)["school-academics.list"]!(ctx(schoolAdmin, { query: {} }));
    expect((result.body as { terms: unknown[] }).terms).toEqual([]);
  });
});

describe("school-academics.close", () => {
  it("closes an open term and audits it", async () => {
    const repo = fakeRepo([row()]);
    const result = await handlers(repo)["school-academics.close"]!(
      ctx(schoolAdmin, { params: { termId: "trm_1" }, body: { reason: "results finalised" } }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "closed", closedReason: "results finalised" });
    expect(result.audit).toEqual({
      resourceId: "trm_1",
      details: { status: "closed", reason: "results finalised" },
    });
    expect(repo.rows[0]!.closedBy).toBe("u_admin");
  });

  it("409s a term that is already closed", async () => {
    const repo = fakeRepo([row({ status: "closed" })]);
    const result = await handlers(repo)["school-academics.close"]!(
      ctx(schoolAdmin, { params: { termId: "trm_1" }, body: {} }),
    );
    expect(result.status).toBe(409);
  });

  it("404s an unknown term BEFORE any scope decision", async () => {
    const repo = fakeRepo([]);
    const result = await handlers(repo)["school-academics.close"]!(
      ctx(foreignAdmin, { params: { termId: "trm_missing" }, body: {} }),
    );
    expect(result.status).toBe(404);
  });
});

describe("school-academics.reopen", () => {
  it("requires a non-empty reason — whitespace is not a reason", async () => {
    const repo = fakeRepo([row({ status: "closed" })]);
    for (const reason of [undefined, "", "   "]) {
      const result = await handlers(repo)["school-academics.reopen"]!(
        ctx(schoolAdmin, { params: { termId: "trm_1" }, body: { reason } }),
      );
      expect(result.status, `reason=${JSON.stringify(reason)}`).toBe(422);
      expect(repo.rows[0]!.status).toBe("closed");
    }
  });

  it("reopens with a reason and puts that reason in the audit trail", async () => {
    const repo = fakeRepo([row({ status: "closed" })]);
    const result = await handlers(repo)["school-academics.reopen"]!(
      ctx(schoolAdmin, { params: { termId: "trm_1" }, body: { reason: "  marks were wrong  " } }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "open", closedReason: "marks were wrong" });
    expect(result.audit).toEqual({
      resourceId: "trm_1",
      details: { status: "open", reason: "marks were wrong" },
    });
  });

  it("409s a term that is already open", async () => {
    const repo = fakeRepo([row()]);
    const result = await handlers(repo)["school-academics.reopen"]!(
      ctx(schoolAdmin, { params: { termId: "trm_1" }, body: { reason: "because" } }),
    );
    expect(result.status).toBe(409);
  });
});

describe("scope enforcement (the shared ScopeChecker, never hand-rolled)", () => {
  it("403s an admin of another school on create", async () => {
    const repo = fakeRepo();
    const result = await handlers(repo)["school-academics.create"]!(
      ctx(foreignAdmin, { body: CREATE_BODY }),
    );
    expect(result.status).toBe(403);
    expect(repo.rows).toHaveLength(0);
  });

  it("403s an admin of another school on close and reopen, leaving the rows untouched", async () => {
    const repo = fakeRepo([row(), row({ id: "trm_2", status: "closed" })]);
    const h = handlers(repo);

    const close = await h["school-academics.close"]!(
      ctx(foreignAdmin, { params: { termId: "trm_1" }, body: {} }),
    );
    const reopen = await h["school-academics.reopen"]!(
      ctx(foreignAdmin, { params: { termId: "trm_2" }, body: { reason: "let me in" } }),
    );

    expect([close.status, reopen.status]).toEqual([403, 403]);
    expect(repo.rows.map((r) => r.status)).toEqual(["open", "closed"]);
  });

  it("403s a non-admin who DOES have containment (the role rule is not skippable)", async () => {
    const teacher = principal({
      id: "u_teacher",
      roles: ["teacher"],
      grants: [{ role: "teacher", org: { collegeId: SCHOOL }, subjectId: "sub_1" }],
    });
    const repo = fakeRepo([row()]);
    const result = await handlers(repo)["school-academics.close"]!(
      ctx(teacher, { params: { termId: "trm_1" }, body: {} }),
    );
    expect(result.status).toBe(403);
    expect(repo.rows[0]!.status).toBe("open");
  });
});
