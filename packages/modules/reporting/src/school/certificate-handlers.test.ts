import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import type { PeopleDirectory } from "@vidya/module-people";
import type { Principal, RouteContext, ScopeChecker } from "@vidya/platform";
import type { RptSchoolCertificateRow } from "../db/schema";
import { principal } from "../../test-support/fakes";
import { createSchoolCertificateHandlers } from "./certificate-handlers";
import { CertificateIssueDenied, type CertificateRepo } from "./certificate-repo";

const org = { collegeId: "col_school", departmentId: "dep_school", classId: "cls_8", sectionId: "sec_8a" };
const row = { id: "cer_1", collegeId: org.collegeId, departmentId: org.departmentId,
  classId: org.classId, sectionId: org.sectionId, studentId: "stu_1", enrollmentId: "enr_1",
  kind: "bonafide", number: "CERT/2026-27/000001", issuedAt: new Date("2026-09-26T10:00:00Z"),
  correctionOfId: null } as RptSchoolCertificateRow;

function context(actor: Principal, body: unknown = {}, params: unknown = {}): RouteContext {
  return { principal: actor, requestId: "req_http", logger: pino({ level: "silent" }),
    request: { body, params, query: {}, headers: new Headers() } };
}

function setup(granted: boolean, edition: "school" | "college" = "school") {
  const scopeChecker = { check: vi.fn((_actor: Principal) => ({ granted, reason: "test" })) } as unknown as ScopeChecker;
  const repo = { issue: vi.fn(async (input: Parameters<CertificateRepo["issue"]>[0]) => {
    if (!input.authorize(org)) throw new CertificateIssueDenied();
    return { row, receipt: null, replay: true };
  }), get: vi.fn(async () => row), list: vi.fn(async () => [row]) };
  const directory = { studentPosition: vi.fn(async () => org) } as unknown as PeopleDirectory;
  const handlers = createSchoolCertificateHandlers({ edition, repo, directory, scopeChecker });
  return { handlers, repo, scopeChecker };
}

describe("school certificate handlers", () => {
  it("checks the recorded source path with leader grants and marks a matching retry", async () => {
    const { handlers, repo, scopeChecker } = setup(true);
    const actor = principal("admin_1", { roles: ["admin", "teacher"], grants: [] });
    const result = await handlers["reporting.school-certificate-issue"]!(context(actor, {
      studentId: "stu_1", enrollmentId: "enr_1", kind: "bonafide", idempotencyKey: "key_1",
    }));
    expect(result.status).toBe(200);
    expect(result.audit?.persisted).toEqual({ kind: "idempotent-replay", resourceId: row.id });
    expect(repo.issue.mock.calls[0]![0]).toMatchObject({ issuedBy: "admin", auditRequestId: "req_http" });
    expect(scopeChecker.check).toHaveBeenCalledWith(expect.objectContaining({ roles: ["admin"] }), "read",
      expect.objectContaining({ org }));
  });

  it("denies issue and download when current scope is lost", async () => {
    const { handlers } = setup(false);
    const actor = principal("principal_1", { roles: ["principal"] });
    expect((await handlers["reporting.school-certificate-issue"]!(context(actor, {
      studentId: "stu_1", enrollmentId: "enr_1", kind: "bonafide", idempotencyKey: "key_1",
    }))).status).toBe(403);
    expect((await handlers["reporting.school-certificate-download"]!(context(actor, {},
      { certificateId: row.id }))).status).toBe(403);
  });

  it("keeps transfer issuance closed until both exit approvals and clearance policy exist", async () => {
    const { handlers, repo } = setup(true);
    const actor = principal("admin_1", { roles: ["admin"] });
    const result = await handlers["reporting.school-certificate-issue"]!(context(actor, {
      studentId: "stu_1", enrollmentId: "enr_1", kind: "transfer", idempotencyKey: "key_1",
    }));
    expect(result.status).toBe(409);
    expect(repo.issue).not.toHaveBeenCalled();
  });

  it("does not expose certificate routes in the college edition", async () => {
    const { handlers, repo } = setup(true, "college");
    const actor = principal("admin_1", { roles: ["admin"] });
    expect((await handlers["reporting.school-certificate-issue"]!(context(actor))).status).toBe(404);
    expect(repo.issue).not.toHaveBeenCalled();
  });
});
