import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createNoticesHandlers, orgOverlaps } from "./handlers";
import type { NoticesRepo } from "./repo";
import type { NoticeRow } from "./db/schema";

const logger = pino({ level: "silent" });
const NOW = new Date("2026-07-13T12:00:00Z");

function principal(roles: Principal["roles"], grants: Principal["grants"]): Principal {
  return { id: "u_1", kind: "user", displayName: "x", roles, scopes: [], grants, sessionId: "s" };
}
const admin = principal(["admin"], [{ role: "admin", org: { collegeId: "col_1" } }]);
const teacher = principal(
  ["teacher"],
  [{ role: "teacher", org: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }, subjectId: "sub_1" }],
);
const student = principal(["student"], []);

function ctx(p: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal: p, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

function notice(id: string, audience: string): NoticeRow {
  return {
    id, collegeId: "col_1", audience, title: `t-${audience}`, body: "b",
    publishAt: new Date("2026-07-10T00:00:00Z"), expiresAt: null, createdBy: "u_adm", createdAt: NOW,
  };
}
const board = [
  notice("n1", "college"),
  notice("n2", "staff"),
  notice("n3", "students"),
  notice("n4", "department:dep_1"),
  notice("n5", "class:cls_1"),
  notice("n6", "class:cls_2"), // another class in another department
];

function makeDeps() {
  const repo = {
    create: async (input: Record<string, unknown>) => ({ ...notice("n_new", input.audience as string), ...input }),
    get: async () => null,
    listForCollege: async () => board,
    listLive: async () => board,
    delete: async () => true,
  } as unknown as NoticesRepo;
  const directory = {
    collegeExists: async () => true,
    departmentPath: async (id: string) => (id === "dep_1" ? { collegeId: "col_1", departmentId: "dep_1" } : null),
    classPath: async (id: string) =>
      id === "cls_1"
        ? { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }
        : id === "cls_2"
          ? { collegeId: "col_1", departmentId: "dep_2", classId: "cls_2" }
          : null,
    studentByIdentityUser: async () => ({ studentId: "stu_1", collegeId: "col_1", fullName: "A", admissionNo: "X-001", status: "active" }),
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
  } as unknown as PeopleDirectory;
  return { repo, directory, now: () => NOW };
}

async function visibleTitles(p: Principal): Promise<string[]> {
  const handlers = createNoticesHandlers(makeDeps());
  const result = await handlers["notices.visible"]!(ctx(p));
  expect(result.status).toBe(200);
  return (result.body as { notices: { audience: string }[] }).notices.map((n) => n.audience);
}

describe("orgOverlaps (pure)", () => {
  it("college-wide overlaps everything in its college, nothing outside", () => {
    expect(orgOverlaps({ collegeId: "c" }, { collegeId: "c", departmentId: "d", classId: "k" })).toBe(true);
    expect(orgOverlaps({ collegeId: "c" }, { collegeId: "other" })).toBe(false);
  });
  it("class grant overlaps its class and its department, not a sibling class", () => {
    const grant = { collegeId: "c", departmentId: "d", classId: "k1" };
    expect(orgOverlaps(grant, { collegeId: "c", departmentId: "d" })).toBe(true);
    expect(orgOverlaps(grant, { collegeId: "c", departmentId: "d", classId: "k2" })).toBe(false);
  });
});

describe("notices.visible — the audience matrix", () => {
  it("teacher sees college, staff, own department and own class — not students or another class", async () => {
    expect(await visibleTitles(teacher)).toEqual(["college", "staff", "department:dep_1", "class:cls_1"]);
  });
  it("student sees college, students, own department and own class — never staff", async () => {
    expect(await visibleTitles(student)).toEqual(["college", "students", "department:dep_1", "class:cls_1"]);
  });
  it("college-wide admin sees every audience except student-only ones", async () => {
    expect(await visibleTitles(admin)).toEqual([
      "college", "staff", "department:dep_1", "class:cls_1", "class:cls_2",
    ]);
  });
});

describe("notices.create", () => {
  it("rejects an expiry before publish with 422", async () => {
    const handlers = createNoticesHandlers(makeDeps());
    const result = await handlers["notices.create"]!(
      ctx(admin, { body: { collegeId: "col_1", audience: "college", title: "T", body: "B", publishAt: "2026-08-01T00:00:00Z", expiresAt: "2026-07-01T00:00:00Z" } }),
    );
    expect(result.status).toBe(422);
  });
  it("404s an audience whose target does not exist", async () => {
    const handlers = createNoticesHandlers(makeDeps());
    const result = await handlers["notices.create"]!(
      ctx(admin, { body: { collegeId: "col_1", audience: "class:cls_missing", title: "T", body: "B" } }),
    );
    expect(result.status).toBe(404);
  });
  it("denies a caller whose grants sit in another college", async () => {
    const stranger = principal(["admin"], [{ role: "admin", org: { collegeId: "col_other" } }]);
    const handlers = createNoticesHandlers(makeDeps());
    const result = await handlers["notices.create"]!(
      ctx(stranger, { body: { collegeId: "col_1", audience: "college", title: "T", body: "B" } }),
    );
    expect(result.status).toBe(403);
  });
  it("creates with a resolved audience label", async () => {
    const handlers = createNoticesHandlers(makeDeps());
    const result = await handlers["notices.create"]!(
      ctx(admin, { body: { collegeId: "col_1", audience: "class:cls_1", title: "Exam room change", body: "B" } }),
    );
    expect(result.status).toBe(201);
    expect((result.body as { audienceLabel: string }).audienceLabel).toBe("n:cls_1");
  });
});

describe("notices.delete", () => {
  it("404s a vanished notice", async () => {
    const handlers = createNoticesHandlers(makeDeps());
    const result = await handlers["notices.delete"]!(ctx(admin, { params: { noticeId: "nope" } }));
    expect(result.status).toBe(404);
  });
});
