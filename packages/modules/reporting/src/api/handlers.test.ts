import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext } from "@vidya/platform";
import { createReportingHandlers } from "./handlers";
import { ReportService } from "../service/report-service";
import type { StudentPerformanceReport } from "@vidya/module-analytics";
import {
  FakeAnalyticsReadModel,
  InMemoryReportsRepo,
  MemoryStore,
  RecordingAudit,
  principal,
} from "../../test-support/fakes";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

const okStudent: StudentPerformanceReport = {
  state: "ok",
  studentId: "stu_1",
  name: "Ravi",
  attendance: { pct: 80, total: 10, monthly: [] },
  subjects: [{ subjectId: "sub_math", name: "Mathematics", avgPct: 70, series: [] }],
  overallPct: 70,
};

function makeHarness(read: FakeAnalyticsReadModel) {
  const service = new ReportService({
    repo: new InMemoryReportsRepo(),
    readModel: read,
    store: new MemoryStore(),
    audit: new RecordingAudit(),
  });
  const enqueued: unknown[] = [];
  const handlers = createReportingHandlers({
    service,
    enqueue: async (payload) => {
      enqueued.push(payload);
    },
  });
  return { handlers, service, enqueued };
}

function ctx(p: Principal | null, input: { body?: unknown; params?: unknown; query?: unknown } = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal: p,
    request: { params: input.params, query: input.query, body: input.body, headers: new Headers() },
  };
}

describe("report request handler", () => {
  it("202 + enqueue for an in-scope target, with audit details", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { handlers, enqueued } = makeHarness(read);
    const result = await handlers["reporting.request"]!(
      ctx(principal("t1"), { body: { format: "csv", academicYear: YEAR, report: { kind: "student-performance", studentId: "stu_1" } } }),
    );
    expect(result.status).toBe(202);
    const reportId = (result.body as { reportId: string }).reportId;
    expect(enqueued).toEqual([{ reportId, source: "api" }]);
    expect(result.audit?.details).toMatchObject({ kind: "student-performance", format: "csv" });
  });

  it("403 when the target is out of scope, 404 when it does not exist", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = { state: "denied" };
    const denied = makeHarness(read);
    expect(
      (await denied.handlers["reporting.request"]!(
        ctx(principal("t1"), { body: { format: "csv", academicYear: YEAR, report: { kind: "student-performance", studentId: "s" } } }),
      )).status,
    ).toBe(403);

    read.student = { state: "not-found" };
    expect(
      (await denied.handlers["reporting.request"]!(
        ctx(principal("t1"), { body: { format: "pdf", academicYear: YEAR, report: { kind: "student-performance", studentId: "ghost" } } }),
      )).status,
    ).toBe(404);
  });
});

describe("status & list handlers (requester-only)", () => {
  it("status is 403 for a non-requester and 404 for unknown", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { handlers, service } = makeHarness(read);
    const row = await service.createRequest(principal("owner"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    expect((await handlers["reporting.status"]!(ctx(principal("owner"), { params: { reportId: row.id } }))).status).toBe(200);
    expect((await handlers["reporting.status"]!(ctx(principal("intruder"), { params: { reportId: row.id } }))).status).toBe(403);
    expect((await handlers["reporting.status"]!(ctx(principal("owner"), { params: { reportId: "rpt_ghost" } }))).status).toBe(404);
  });

  it("list returns only the caller's reports", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { handlers, service } = makeHarness(read);
    await service.createRequest(principal("a"), { kind: "student-performance", studentId: "s" }, "csv", YEAR);
    const result = await handlers["reporting.list"]!(ctx(principal("a"), { query: { limit: 25 } }));
    expect((result.body as { reports: unknown[] }).reports).toHaveLength(1);
  });
});

describe("download handler streams bytes with a disposition header", () => {
  it("200 with attachment for the requester; 403 for others", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { handlers, service } = makeHarness(read);
    const row = await service.createRequest(principal("owner"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    await service.run(row.id, logger);

    const ok = await handlers["reporting.download"]!(ctx(principal("owner"), { params: { reportId: row.id } }));
    expect(ok.status).toBe(200);
    expect(ok.body).toBeInstanceOf(Uint8Array);
    expect(ok.headers?.["content-disposition"]).toContain("attachment");
    expect(ok.contentType).toContain("text/csv");

    const denied = await handlers["reporting.download"]!(ctx(principal("intruder"), { params: { reportId: row.id } }));
    expect(denied.status).toBe(403);
  });

  it("409 while the report is still pending", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { handlers, service } = makeHarness(read);
    const row = await service.createRequest(principal("owner"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    expect((await handlers["reporting.download"]!(ctx(principal("owner"), { params: { reportId: row.id } }))).status).toBe(409);
  });
});
