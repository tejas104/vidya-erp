import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import type { OrgPath, Principal, RouteContext, ScopeChecker, ScopeDecision } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createReportingHandlers, type CredentialIssuer } from "./handlers";
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

/** TEST DOUBLE — the real matrix is the human core; here we script decisions. */
class StubScopeChecker implements ScopeChecker {
  decision: ScopeDecision = { granted: true, reason: "stub-allow" };
  readonly calls: { action: string; resource: unknown }[] = [];
  check(_principal: Principal, action: string, resource: unknown): ScopeDecision {
    this.calls.push({ action, resource });
    return this.decision;
  }
}

const CLASS_ID = "cls_1";
const CLASS_PATH: OrgPath = { collegeId: "col_1", departmentId: "dep_1", classId: CLASS_ID };

/** Minimal PeopleDirectory double: only classPath/classRoster/namesFor are
 *  reached by the class-credentials handler; every other member is unused
 *  filler so this satisfies the interface. */
class FakePeopleDirectory implements PeopleDirectory {
  roster: { studentId: string; admissionNo: string; fullName: string; identityUserId: string | null }[] = [
    { studentId: "stu_1", admissionNo: "A001", fullName: "Meera Nair", identityUserId: null },
    { studentId: "stu_2", admissionNo: "A002", fullName: "Ravi Kumar", identityUserId: "idn_existing" },
  ];
  async classPath(classId: string): Promise<OrgPath | null> {
    return classId === CLASS_ID ? CLASS_PATH : null;
  }
  async classRoster(classId: string) {
    return classId === CLASS_ID ? this.roster : [];
  }
  async namesFor(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map(ids.filter((id) => id === CLASS_ID).map((id) => [id, "FY BSc CS"]));
  }
  async sectionPath(): Promise<OrgPath | null> { return null; }
  async departmentPath(): Promise<OrgPath | null> { return null; }
  async collegeExists(): Promise<boolean> { return false; }
  async sectionRoster(): Promise<{ studentId: string; academicYear: string }[]> { return []; }
  async studentPosition(): Promise<OrgPath | null> { return null; }
  async studentByIdentityUser() { return null; }
  async teacherByIdentityUser() { return null; }
  async teacherDepartments(): Promise<string[]> { return []; }
  async studentsExist(): Promise<Set<string>> { return new Set(); }
  async studentsBrief(): Promise<Map<string, { fullName: string; admissionNo: string }>> { return new Map(); }
  async subjectDepartment(): Promise<string | null> { return null; }
  async sectionsWithLiveEnrollment(): Promise<string[]> { return []; }
  async sectionsOfClass(): Promise<{ sectionId: string; name: string }[]> { return []; }
  async departmentsOfCollege(): Promise<{ departmentId: string; name: string }[]> { return []; }
  async classesOfDepartment(): Promise<{ classId: string; name: string }[]> { return []; }
}

/** Deterministic — assigns a fresh, unique fake identity user id per call. */
function fakeIdentity(): CredentialIssuer & { calls: unknown[] } {
  let n = 0;
  const calls: unknown[] = [];
  return {
    calls,
    issueCredential: async (input) => {
      calls.push(input);
      n += 1;
      return { userId: `idn_fake_${n}`, username: input.username, temporaryPassword: `Fak3Pass!${n}` };
    },
  };
}

const okStudent: StudentPerformanceReport = {
  state: "ok",
  studentId: "stu_1",
  name: "Ravi",
  attendance: { pct: 80, total: 10, monthly: [] },
  subjects: [{ subjectId: "sub_math", name: "Mathematics", avgPct: 70, series: [] }],
  overallPct: 70,
};

function makeHarness(
  read: FakeAnalyticsReadModel,
  opts: { linkStudentIdentity?: (studentId: string, identityUserId: string) => Promise<boolean> } = {},
) {
  const service = new ReportService({
    repo: new InMemoryReportsRepo(),
    readModel: read,
    store: new MemoryStore(),
    audit: new RecordingAudit(),
  });
  const enqueued: unknown[] = [];
  const scopeChecker = new StubScopeChecker();
  const peopleDirectory = new FakePeopleDirectory();
  const identity = fakeIdentity();
  const linked: { studentId: string; identityUserId: string }[] = [];
  const handlers = createReportingHandlers({
    service,
    enqueue: async (payload) => {
      enqueued.push(payload);
    },
    scopeChecker,
    peopleDirectory,
    linkStudentIdentity:
      opts.linkStudentIdentity ??
      (async (studentId, identityUserId) => {
        linked.push({ studentId, identityUserId });
        return true;
      }),
    identity,
  });
  return { handlers, service, enqueued, scopeChecker, peopleDirectory, identity, linked };
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

describe("class-credentials handler (#11 B4, synchronous)", () => {
  it("issues logins only for students who lack one, streams a PDF, and audits the count — never the plaintext", async () => {
    const read = new FakeAnalyticsReadModel();
    const { handlers, identity, linked } = makeHarness(read);
    const result = await handlers["reporting.class-credentials"]!(
      ctx(principal("admin-1", { roles: ["admin"] }), { params: { classId: CLASS_ID } }),
    );

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/pdf");
    expect(result.body).toBeInstanceOf(Uint8Array);
    // %PDF- magic bytes — a real rendered document, not a stub.
    expect(new TextDecoder().decode((result.body as Uint8Array).slice(0, 5))).toBe("%PDF-");
    expect(result.headers?.["content-disposition"]).toContain("attachment");

    // Roster has one student with a login already (idn_existing) and one
    // without — only the one without gets issued and linked.
    expect(identity.calls).toEqual([
      expect.objectContaining({ username: "a001", roles: ["student"] }),
    ]);
    expect(linked).toEqual([{ studentId: "stu_1", identityUserId: "idn_fake_1" }]);

    // Never the plaintext temporary password in the audit trail.
    const details = JSON.stringify(result.audit?.details ?? {});
    expect(details).not.toContain("Fak3Pass");
    expect(result.audit?.details).toMatchObject({ issuedCount: 1, rosterSize: 2 });
  });

  it("skips the row and warns, but still succeeds, when linking a newly-issued identity fails", async () => {
    const read = new FakeAnalyticsReadModel();
    const failedLinks: { studentId: string; identityUserId: string }[] = [];
    const { handlers, identity } = makeHarness(read, {
      linkStudentIdentity: async (studentId, identityUserId) => {
        failedLinks.push({ studentId, identityUserId });
        return false;
      },
    });
    const warnSpy = vi.spyOn(logger, "warn");
    const result = await handlers["reporting.class-credentials"]!(
      ctx(principal("admin-1", { roles: ["admin"] }), { params: { classId: CLASS_ID } }),
    );

    expect(result.status).toBe(200);
    // The account was still issued upstream — that's the orphan risk — but
    // because linking it back to the student failed, no row for it is
    // printed and the count does not claim it as issued.
    expect(identity.calls).toHaveLength(1);
    expect(failedLinks).toEqual([{ studentId: "stu_1", identityUserId: "idn_fake_1" }]);
    expect(result.audit?.details).toMatchObject({ issuedCount: 0, rosterSize: 2 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: "stu_1", identityUserId: "idn_fake_1" }),
      expect.stringContaining("linking"),
    );
    warnSpy.mockRestore();
  });

  it("403s when the scope check denies", async () => {
    const read = new FakeAnalyticsReadModel();
    const { handlers, scopeChecker, identity } = makeHarness(read);
    scopeChecker.decision = { granted: false, reason: "out of scope" };
    const result = await handlers["reporting.class-credentials"]!(
      ctx(principal("teacher-1"), { params: { classId: CLASS_ID } }),
    );
    expect(result.status).toBe(403);
    expect(identity.calls).toHaveLength(0);
  });

  it("404s for an unknown class", async () => {
    const read = new FakeAnalyticsReadModel();
    const { handlers } = makeHarness(read);
    const result = await handlers["reporting.class-credentials"]!(
      ctx(principal("admin-1", { roles: ["admin"] }), { params: { classId: "cls_ghost" } }),
    );
    expect(result.status).toBe(404);
  });
});
