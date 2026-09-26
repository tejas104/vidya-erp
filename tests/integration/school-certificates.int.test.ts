import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let admin: string;
let collegeId: string;
let sectionId: string;
const year = "2026-27";
const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric",
  month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const part = (kind: string) => dateParts.find((item) => item.type === kind)?.value ?? "";
const today = `${part("year")}-${part("month")}-${part("day")}`;
const joinedOn = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);

async function create(route: string, body: unknown) {
  const response = await stack.call(route, { cookie: admin, body });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string };
}
async function pupil(name: string) {
  const student = await create("people.student-create", { collegeId,
    admissionNo: `CER-${randomUUID().slice(0, 8)}`, fullName: name });
  const enrolled = await stack.call("people.student-enroll", { cookie: admin,
    params: { studentId: student.id }, body: { sectionId, academicYear: year, startsOn: joinedOn } });
  expect(enrolled.status, await enrolled.clone().text()).toBe(200);
  return { studentId: student.id, enrollmentId: ((await enrolled.json()) as { enrollmentId: string }).enrollmentId };
}
function issue(source: { studentId: string; enrollmentId: string }, kind: "bonafide" | "transfer",
  key: string, correctionOfId?: string) {
  return stack.call("reporting.school-certificate-issue", { cookie: admin,
    body: { ...source, kind, idempotencyKey: key, ...(correctionOfId ? { correctionOfId } : {}) } });
}

beforeAll(async () => {
  stack = buildStack("school");
  const boot = await stack.bootstrap();
  admin = boot.adminCookie;
  collegeId = boot.collegeId;
  const departmentId = (await stack.people.service.ensureImplicitDepartment(collegeId)).departmentId;
  const klass = await create("people.class-create", { departmentId,
    name: "Certificate test class", code: `CER-${randomUUID().slice(0, 8)}` });
  sectionId = (await create("people.section-create", { classId: klass.id, name: "A" })).id;
});
afterAll(async () => {
  if (stack) { stack.reportingAuditFault.failAction = null; await stack.close(); }
});

describe("school certificates over real Postgres and the route gate", () => {
  it("allocates, replays and corrects immutable bonafide records, with scoped PDF", async () => {
    const student = await pupil("Bonafide Pupil");
    const key = randomUUID();
    const first = await issue(student, "bonafide", key);
    expect(first.status, await first.clone().text()).toBe(201);
    const issued = (await first.json()) as { certificateId: string; number: string; replay: boolean };
    expect(issued).toMatchObject({ number: "CERT/2026-27/000001", replay: false });
    const retry = await issue(student, "bonafide", key);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ certificateId: issued.certificateId, number: issued.number, replay: true });
    const changed = await issue(student, "transfer", key);
    expect(changed.status).toBe(409);
    const correction = await issue(student, "bonafide", randomUUID(), issued.certificateId);
    expect(correction.status, await correction.clone().text()).toBe(201);
    const corrected = (await correction.json()) as { certificateId: string; number: string };
    expect(corrected.number).toBe("CERT/2026-27/000002");
    const listed = await stack.call("reporting.school-certificates-for-student", { cookie: admin,
      params: { studentId: student.studentId } });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as object).toMatchObject({ certificates: expect.arrayContaining([
      expect.objectContaining({ certificateId: issued.certificateId }),
      expect.objectContaining({ certificateId: corrected.certificateId, correctionOfId: issued.certificateId }),
    ]) });
    const download = await stack.call("reporting.school-certificate-download", { cookie: admin,
      params: { certificateId: corrected.certificateId } });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await stack.call("reporting.school-certificate-download", {
      params: { certificateId: corrected.certificateId } })).status).toBe(401);
    await expect(stack.pool.query("DELETE FROM rpt_school_certificates WHERE id = $1", [issued.certificateId]))
      .rejects.toThrow(/append-only/);
  });

  it("blocks transfer issuance and rolls a failed bonafide audit back without consuming a number", async () => {
    const student = await pupil("Second Pupil");
    expect((await issue(student, "transfer", randomUUID())).status).toBe(409);
    const before = await stack.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM rpt_school_certificates");
    const failedKey = randomUUID();
    stack.reportingAuditFault.failAction = "reporting.school-certificate-issue-requested";
    try { expect((await issue(student, "bonafide", failedKey)).status).toBe(500); }
    finally { stack.reportingAuditFault.failAction = null; }
    const after = await stack.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM rpt_school_certificates");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const issued = await issue(student, "bonafide", failedKey);
    expect(issued.status, await issued.clone().text()).toBe(201);
    const second = (await issued.json()) as { certificateId: string; number: string };
    expect(second.number).toBe("CERT/2026-27/000003");
    const audit = await stack.pool.query("SELECT action FROM sys_audit_log WHERE action = $1 AND resource_id = $2",
      ["reporting.school-certificate-issue-requested", second.certificateId]);
    expect(audit.rows).toHaveLength(1);
  });
});
