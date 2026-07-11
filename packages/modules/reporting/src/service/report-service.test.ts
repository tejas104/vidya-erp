import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { ReportService } from "./report-service";
import type { StudentPerformanceReport } from "@vidya/module-analytics";
import {
  FakeAnalyticsReadModel,
  InMemoryReportsRepo,
  MemoryStore,
  RecordingAudit,
  principal,
} from "../../test-support/fakes";

const log = pino({ level: "silent" });
const YEAR = "2026-27";

const okStudent: StudentPerformanceReport = {
  state: "ok",
  studentId: "stu_1",
  name: "Ravi Kumar",
  attendance: { pct: 88, total: 40, monthly: [{ month: "2026-07", pct: 88 }] },
  subjects: [{ subjectId: "sub_math", name: "Mathematics", avgPct: 72, series: [{ label: "Midterm", pct: 72 }] }],
  overallPct: null,
};

function makeService(read: FakeAnalyticsReadModel) {
  const repo = new InMemoryReportsRepo();
  const store = new MemoryStore();
  const audit = new RecordingAudit();
  const finished: string[] = [];
  const service = new ReportService({
    repo,
    readModel: read,
    store,
    audit,
    onFinished: (kind, format, status) => finished.push(`${kind}:${format}:${status}`),
  });
  return { service, repo, store, audit, finished };
}

describe("request → generate → store", () => {
  it("snapshots the requester's scope, generates a CSV, uploads and audits", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service, store, audit, finished } = makeService(read);
    const requester = principal("teacher-1", { displayName: "Priya", grants: [{ role: "teacher", org: { collegeId: "c" }, subjectId: "sub_math" }] });

    const row = await service.createRequest(requester, { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    expect((row.requesterPrincipal as { grants: unknown[] }).grants).toHaveLength(1);

    await service.run(row.id, log);
    const stored = store.objects.get(`reports/${row.id}.csv`);
    expect(stored).toBeDefined();
    const text = new TextDecoder().decode(stored);
    expect(text).toContain("Student performance report");
    expect(text).toContain("Mathematics,72%");
    expect(audit.actions()).toContain("reporting.report-generated");
    expect(finished).toEqual(["student-performance:csv:completed"]);
  });

  it("generates a real PDF (starts with %PDF, non-trivial size)", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service, store } = makeService(read);
    const requester = principal("teacher-1");
    const row = await service.createRequest(requester, { kind: "student-performance", studentId: "stu_1" }, "pdf", YEAR);
    await service.run(row.id, log);
    const bytes = store.objects.get(`reports/${row.id}.pdf`)!;
    expect(bytes.length).toBeGreaterThan(500);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("fails closed (audited) when the requester's scope no longer yields content at generation", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service, repo } = makeService(read);
    const row = await service.createRequest(principal("teacher-1"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    read.student = { state: "denied" }; // scope revoked between request and job
    await service.run(row.id, log);
    expect((await repo.get(row.id))?.status).toBe("failed");
  });

  it("marks the report failed and rethrows when rendering/upload throws", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const repo = new InMemoryReportsRepo();
    const audit = new RecordingAudit();
    const finished: string[] = [];
    const service = new ReportService({
      repo,
      readModel: read,
      store: {
        put: async () => {
          throw new Error("object store down");
        },
        get: async () => new Uint8Array(),
      },
      audit,
      onFinished: (kind, format, status) => finished.push(`${kind}:${format}:${status}`),
    });
    const row = await service.createRequest(principal("t1"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    await expect(service.run(row.id, log)).rejects.toThrow(/object store down/);
    expect((await repo.get(row.id))?.status).toBe("failed");
    expect(finished).toEqual(["student-performance:csv:failed"]);
  });

  it("ignores a job for an unknown report id", async () => {
    const read = new FakeAnalyticsReadModel();
    const { service } = makeService(read);
    await expect(service.run("rpt_ghost", log)).resolves.toBeUndefined();
  });

  it("falls back to the requester id when there is no display name", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service, store } = makeService(read);
    const nameless = principal("teacher-x", { displayName: null });
    const row = await service.createRequest(nameless, { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    expect((row.requesterPrincipal as { displayName: string }).displayName).toBe("teacher-x");
    await service.run(row.id, log);
    expect(new TextDecoder().decode(store.objects.get(`reports/${row.id}.csv`))).toContain("teacher-x");
  });

  it("records a generic error message when a non-Error is thrown", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const repo = new InMemoryReportsRepo();
    const service = new ReportService({
      repo,
      readModel: read,
      store: {
        put: async () => {
          throw "not-an-error-object";
        },
        get: async () => new Uint8Array(),
      },
      audit: new RecordingAudit(),
    });
    const row = await service.createRequest(principal("t1"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    await expect(service.run(row.id, log)).rejects.toBeDefined();
    expect((await repo.get(row.id))?.error).toBe("generation failed");
  });

  it("skips an already-completed report (idempotent re-delivery)", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service, store } = makeService(read);
    const row = await service.createRequest(principal("teacher-1"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    await service.run(row.id, log);
    const first = store.objects.get(`reports/${row.id}.csv`);
    await service.run(row.id, log);
    expect(store.objects.get(`reports/${row.id}.csv`)).toBe(first);
  });
});

describe("scoped download (ADR-0020) — the URL-guessing proof", () => {
  async function completed() {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const ctx = makeService(read);
    const row = await ctx.service.createRequest(principal("owner"), { kind: "student-performance", studentId: "stu_1" }, "pdf", YEAR);
    await ctx.service.run(row.id, log);
    return { ...ctx, read, reportId: row.id };
  }

  it("the requester downloads the artifact", async () => {
    const { service, reportId } = await completed();
    const result = await service.download(principal("owner"), reportId);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.filename).toContain(reportId);
      expect(result.contentType).toBe("application/pdf");
    }
  });

  it("a DIFFERENT user cannot download it by guessing the id (403, no bytes read)", async () => {
    const { service, reportId } = await completed();
    expect((await service.download(principal("intruder"), reportId)).state).toBe("forbidden");
  });

  it("the requester loses access if their CURRENT scope no longer covers the target", async () => {
    const { service, read, reportId } = await completed();
    read.student = { state: "denied" }; // scope revoked after generation
    expect((await service.download(principal("owner"), reportId)).state).toBe("forbidden");
  });

  it("audits every successful download", async () => {
    const { service, audit, reportId } = await completed();
    await service.download(principal("owner"), reportId);
    expect(audit.actions()).toContain("reporting.report-downloaded");
  });

  it("404 for unknown ids; 409 while still pending", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service } = makeService(read);
    expect((await service.download(principal("owner"), "rpt_ghost")).state).toBe("not-found");
    const row = await service.createRequest(principal("owner"), { kind: "student-performance", studentId: "stu_1" }, "csv", YEAR);
    expect((await service.download(principal("owner"), row.id)).state).toBe("not-ready");
  });
});

describe("listMine", () => {
  it("returns only the caller's reports", async () => {
    const read = new FakeAnalyticsReadModel();
    read.student = okStudent;
    const { service } = makeService(read);
    await service.createRequest(principal("a"), { kind: "student-performance", studentId: "s" }, "csv", YEAR);
    await service.createRequest(principal("b"), { kind: "student-performance", studentId: "s" }, "csv", YEAR);
    const mine = await service.listMine(principal("a"), 25);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.requestedBy).toBe("a");
  });
});
