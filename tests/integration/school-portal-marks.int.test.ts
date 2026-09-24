import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

const suffix = randomUUID().slice(0, 8);
const year = "2026-27";
const password = "term-marks-pass-123";
let stack: Stack;
let admin: string;
let student: string;
let guardian: string;
let teacher: string;
let studentId: string;
let otherStudentId: string;
let termId: string;
let assessmentOne: string;
let assessmentTwo: string;

async function create(route: string, body: unknown, params?: Record<string, string>) {
  const response = await stack.call(route, { cookie: admin, body, params });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return await response.json() as { id: string };
}

async function studentLogin(collegeId: string) {
  const username = `marks-student-${suffix}`;
  const user = await create("identity.user-create", { username, displayName: "Asha", collegeId, temporaryPassword: "temporary-pass-123", roles: ["student"] });
  const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId: user.id } });
  const { token } = await reset.json() as { token: string };
  expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: password } })).status).toBe(200);
  expect((await stack.call("people.student-link-identity", { cookie: admin, params: { studentId }, body: { identityUserId: user.id } })).status).toBe(200);
  return stack.login(username, password);
}

async function teacherLogin(collegeId: string, classId: string, subjectId: string) {
  const username = `marks-teacher-${suffix}`;
  const user = await create("identity.user-create", { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] });
  const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId: user.id } });
  const { token } = await reset.json() as { token: string };
  expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: password } })).status).toBe(200);
  const person = await create("people.teacher-create", { collegeId, staffNo: username, fullName: username });
  expect((await stack.call("people.teacher-link-identity", { cookie: admin, params: { teacherId: person.id }, body: { identityUserId: user.id } })).status).toBe(200);
  await create("people.assignment-create", { classId, subjectId, kind: "subject_teacher", academicYear: year }, { teacherId: person.id });
  return stack.login(username, password);
}

const own = () => stack.call("portal.my-school-marks", { cookie: student, query: { academicYear: year } });
const child = (id = studentId) => stack.call("portal.child-school-marks", { cookie: guardian, params: { studentId: id }, query: { academicYear: year } });

beforeAll(async () => {
  stack = buildStack("school");
  const boot = await stack.bootstrap();
  admin = boot.adminCookie;
  const { collegeId } = boot;
  const { departmentId } = await stack.people.service.ensureImplicitDepartment(collegeId);
  const klass = await create("people.class-create", { departmentId, name: `Std ${suffix}`, code: `TM-${suffix}` });
  const section = await create("people.section-create", { classId: klass.id, name: "A" });
  const subject = await create("people.subject-create", { departmentId, name: "Mathematics", code: `TM-M-${suffix}` });
  studentId = (await create("people.student-create", { collegeId, admissionNo: `TM-${suffix}`, fullName: "Asha" })).id;
  otherStudentId = (await create("people.student-create", { collegeId, admissionNo: `TM-O-${suffix}`, fullName: "Other" })).id;
  for (const id of [studentId, otherStudentId]) {
    expect((await stack.call("people.student-enroll", { cookie: admin, params: { studentId: id }, body: { sectionId: section.id, academicYear: year } })).status).toBe(200);
  }
  student = await studentLogin(collegeId);
  teacher = await teacherLogin(collegeId, klass.id, subject.id);
  const invitation = await stack.call("people.guardian-invitation-issue", { cookie: admin, params: { studentId }, body: { guardianName: "Leela", relationshipType: "parent", contactMethod: "email", contactValue: `term-${suffix}@example.test` } });
  expect(invitation.status).toBe(201);
  const { code } = await invitation.json() as { code: string };
  const parentName = `term-parent-${suffix}`;
  expect((await stack.call("people.guardian-activate", { body: { code, fullName: "Leela", username: parentName, password } })).status).toBe(201);
  guardian = await stack.login(parentName, password);

  termId = (await create("school-academics.create", { collegeId, name: `Term ${suffix}`, academicYear: year, startsOn: "2026-06-01", endsOn: "2026-06-30" })).id;
  const types = await stack.call("school-academics.types-set", { cookie: admin, params: { termId }, body: { types: [{ name: "Exam", weight: 100 }] } });
  expect(types.status).toBe(200);
  const typeId = (await types.json() as { types: { id: string }[] }).types[0]!.id;
  const scaleId = (await create("results.scale-create", { collegeId, name: `Scale ${suffix}`, bands: [{ minPct: 80, grade: "A", points: 10 }, { minPct: 0, grade: "B", points: 5 }] })).id;
  for (const [index, name] of ["Unit 1", "Unit 2"].entries()) {
    const assessment = await stack.call("school-academics.assessment-create", { cookie: teacher, body: { classId: klass.id, subjectId: subject.id, termId, typeId, scaleId, name, maxScore: 20, heldOn: `2026-06-${String(index + 5).padStart(2, "0")}` } });
    expect(assessment.status, await assessment.clone().text()).toBe(201);
    if (index === 0) assessmentOne = (await assessment.json() as { id: string }).id;
    else assessmentTwo = (await assessment.json() as { id: string }).id;
  }
});

afterAll(async () => { await stack?.close(); });

describe("school portal term marks", () => {
  it("requires student and guardian authentication and hides open terms", async () => {
    expect((await stack.call("portal.my-school-marks", { query: { academicYear: year } })).status).toBe(401);
    expect((await stack.call("portal.child-school-marks", { params: { studentId }, query: { academicYear: year } })).status).toBe(401);
    expect(await (await own()).json()).toEqual({ terms: [] });
    expect(await (await child()).json()).toEqual({ terms: [] });
    expect((await child(otherStudentId)).status).toBe(403);
    expect((await stack.call("portal.child-school-marks", { cookie: student, params: { studentId }, query: { academicYear: year } })).status).toBe(403);
    expect((await stack.call("portal.my-school-marks", { cookie: guardian, query: { academicYear: year } })).status).toBe(403);
  });

  it("releases incomplete then corrected weighted results only while closed", async () => {
    expect((await stack.call("school-academics.marks-enter", { cookie: teacher, params: { assessmentId: assessmentOne }, body: { entries: [{ studentId, score: 16 }] } })).status).toBe(200);
    expect((await stack.call("school-academics.close", { cookie: admin, params: { termId }, body: {} })).status).toBe(200);
    const incomplete = await own();
    expect(incomplete.status, await incomplete.clone().text()).toBe(200);
    expect(await incomplete.json()).toMatchObject({ terms: [{ termId, overallPct: null, complete: false, subjects: [{ name: "Mathematics", percentage: null, status: "incomplete", recordedCount: 1, assessmentCount: 2, assessments: [{ name: "Unit 1", score: 16, maxScore: 20, status: "scored" }, { name: "Unit 2", score: null, status: "missing" }] }] }] });
    expect(await (await child()).json()).toMatchObject({ terms: [{ termId, overallPct: null }] });

    expect((await stack.call("school-academics.reopen", { cookie: admin, params: { termId }, body: { reason: "Record second score" } })).status).toBe(200);
    expect(await (await own()).json()).toEqual({ terms: [] });
    expect(await (await child()).json()).toEqual({ terms: [] });
    expect((await stack.call("school-academics.marks-enter", { cookie: teacher, params: { assessmentId: assessmentTwo }, body: { entries: [{ studentId, score: 20 }] } })).status).toBe(200);
    expect((await stack.call("school-academics.close", { cookie: admin, params: { termId }, body: {} })).status).toBe(200);
    expect(await (await own()).json()).toMatchObject({ terms: [{ termId, overallPct: 90, complete: true, subjects: [{ percentage: 90, status: "complete", recordedCount: 2 }] }] });
    expect(await (await child()).json()).toMatchObject({ terms: [{ termId, overallPct: 90 }] });
    expect(await (await stack.call("portal.my-school-marks", { cookie: student, query: { academicYear: "2025-26" } })).json()).toEqual({ terms: [] });
  });

  it("keeps a previously closed term private until an authorized explicit release", async () => {
    // Model a row closed before the release-marker migration. The migration
    // leaves this field null instead of disclosing historical scores.
    await stack.pool.query("UPDATE sca_terms SET marks_released_at = NULL WHERE id = $1", [termId]);
    expect(await (await own()).json()).toEqual({ terms: [] });
    expect(await (await child()).json()).toEqual({ terms: [] });
    expect((await stack.call("school-academics.release-marks", { cookie: guardian, params: { termId } })).status).toBe(403);
    const released = await stack.call("school-academics.release-marks", { cookie: admin, params: { termId } });
    expect(released.status, await released.clone().text()).toBe(200);
    expect((await released.json() as { marksReleasedAt: string | null }).marksReleasedAt).not.toBeNull();
    expect(await (await own()).json()).toMatchObject({ terms: [{ termId, overallPct: 90 }] });
    expect((await stack.call("school-academics.release-marks", { cookie: admin, params: { termId } })).status).toBe(409);
  });
});
