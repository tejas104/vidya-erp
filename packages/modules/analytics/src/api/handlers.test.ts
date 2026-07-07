import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RedisClient, RouteContext, ScopeGrant } from "@vidya/platform";
import { createIdentityCore } from "@vidya/module-identity";
import { createAnalyticsHandlers } from "./handlers";
import { QueryService } from "../service/query-service";
import {
  FakeAcademicsRead,
  FakeDirectory,
  InMemoryRollupsRepo,
  ORG,
  paths,
} from "../../test-support/fakes";

const logger = pino({ level: "silent" });
const core = createIdentityCore({ redis: {} as RedisClient, session: { ttlHours: 1, idleMinutes: 1 } });
const YEAR = "2026-27";

function caller(id: string, roles: Principal["roles"], grants: ScopeGrant[]): Principal {
  return { id, kind: "user", displayName: id, roles, scopes: [], grants, sessionId: "s" };
}
const mathTeacher = caller("t-math", ["teacher"], [
  { role: "teacher", org: paths.class, subjectId: ORG.mathId },
]);
const admin = caller("a-1", ["admin"], [{ role: "admin", org: paths.college }]);

async function makeHarness() {
  const repo = new InMemoryRollupsRepo();
  const read = new FakeAcademicsRead();
  const directory = new FakeDirectory();
  const query = new QueryService({
    repo,
    academicsRead: read,
    directory,
    scopeChecker: core.scopeChecker,
    minCohort: 5,
  });
  const enqueued: unknown[] = [];
  const handlers = createAnalyticsHandlers({
    query,
    directory,
    enqueueRollup: async (payload) => {
      enqueued.push(payload);
    },
  });
  await repo.replaceYear(YEAR, {
    attendance: [
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        ...paths.class,
        academicYear: YEAR,
        period: "YTD",
        sessions: 10,
        present: 90,
        absent: 10,
        late: 0,
        excused: 0,
        distinctStudents: 10,
      },
    ],
    marks: [
      {
        scopeLevel: "class",
        nodeId: ORG.classId,
        collegeId: ORG.collegeId,
        departmentId: ORG.departmentId,
        classId: ORG.classId,
        academicYear: YEAR,
        period: "YTD",
        subjectId: ORG.mathId,
        subjects: [ORG.mathId],
        avgPct: 70,
        nMarks: 10,
        distinctStudents: 10,
      },
    ],
    flags: [],
  });
  return { handlers, enqueued };
}

function ctx(principal: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal,
    request: { params: input.params, query: input.query, body: input.body, headers: new Headers() },
  };
}

describe("analytics handlers", () => {
  it("rollup returns named node + scope-served slots; 404 for unknown nodes", async () => {
    const { handlers } = await makeHarness();
    const result = await handlers["analytics.rollup"]!(
      ctx(mathTeacher, { params: { level: "class", nodeId: ORG.classId }, query: { academicYear: YEAR } }),
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      node: { name: string };
      attendance: { state: string };
      marks: { bySubject: { name: string }[]; overall: { state: string } };
    };
    expect(body.node.name).toBe("BSc Year 1");
    expect(body.attendance.state).toBe("ok");
    expect(body.marks.bySubject[0]?.name).toBe("Mathematics");
    expect(body.marks.overall.state).toBe("no-data"); // no cross-subject row seeded
    expect(
      (
        await handlers["analytics.rollup"]!(
          ctx(mathTeacher, { params: { level: "class", nodeId: "cls_ghost" }, query: { academicYear: YEAR } }),
        )
      ).status,
    ).toBe(404);
  });

  it("rollup answers 403 when every component is denied", async () => {
    const { handlers } = await makeHarness();
    const stranger = caller("t-x", ["teacher"], [
      { role: "teacher", org: { collegeId: "col_other", departmentId: "d", classId: "c" }, subjectId: "s" },
    ]);
    const result = await handlers["analytics.rollup"]!(
      ctx(stranger, { params: { level: "class", nodeId: ORG.classId }, query: { academicYear: YEAR } }),
    );
    expect(result.status).toBe(403);
  });

  it("dashboard reflects grants; at-risk 404s unknown nodes", async () => {
    const { handlers } = await makeHarness();
    const dashboard = await handlers["analytics.dashboard"]!(
      ctx(mathTeacher, { query: { academicYear: YEAR } }),
    );
    expect(dashboard.status).toBe(200);
    expect((dashboard.body as { tiles: unknown[] }).tiles).toHaveLength(1);
    expect(
      (
        await handlers["analytics.at-risk"]!(
          ctx(mathTeacher, { params: { level: "class", nodeId: "cls_ghost" }, query: { academicYear: YEAR } }),
        )
      ).status,
    ).toBe(404);
  });

  it("recompute enqueues the worker job and contributes audit details", async () => {
    const { handlers, enqueued } = await makeHarness();
    const result = await handlers["analytics.recompute"]!(
      ctx(admin, { body: { academicYear: YEAR } }),
    );
    expect(result.status).toBe(202);
    expect(enqueued).toEqual([{ academicYear: YEAR, source: "api" }]);
    expect(result.audit?.details).toEqual({ academicYear: YEAR });
  });

  it("student performance 404s unknown students", async () => {
    const { handlers } = await makeHarness();
    expect(
      (
        await handlers["analytics.student-performance"]!(
          ctx(mathTeacher, { params: { studentId: "stu_ghost" }, query: { academicYear: YEAR } }),
        )
      ).status,
    ).toBe(404);
  });

  it("compare returns named children with served slots; 404 unknown parent", async () => {
    const { handlers } = await makeHarness();
    const principal = caller("p-1", ["principal"], [{ role: "principal", org: paths.college }]);
    const ok = await handlers["analytics.compare"]!(
      ctx(principal, { params: { level: "department", nodeId: ORG.departmentId }, query: { academicYear: YEAR } }),
    );
    expect(ok.status).toBe(200);
    const body = ok.body as { parent: { name: string }; childLevel: string; children: unknown[] };
    expect(body.parent.name).toBe("Science");
    expect(body.childLevel).toBe("class");
    expect(
      (await handlers["analytics.compare"]!(
        ctx(principal, { params: { level: "college", nodeId: "col_ghost" }, query: { academicYear: YEAR } }),
      )).status,
    ).toBe(404);
  });

  it("distribution 404s unknown nodes and returns histogram states", async () => {
    const { handlers } = await makeHarness();
    const principal = caller("p-2", ["principal"], [{ role: "principal", org: paths.college }]);
    expect(
      (await handlers["analytics.distribution"]!(
        ctx(principal, { params: { level: "section", nodeId: "sec_ghost" }, query: { academicYear: YEAR } }),
      )).status,
    ).toBe(404);
    const ok = await handlers["analytics.distribution"]!(
      ctx(principal, { params: { level: "class", nodeId: ORG.classId }, query: { academicYear: YEAR } }),
    );
    expect(ok.status).toBe(200);
    expect((ok.body as { marks: { state: string } }).marks.state).toBeDefined();
  });
});
