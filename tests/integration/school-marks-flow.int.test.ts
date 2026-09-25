import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let admin: string, teacher: string, otherTeacher: string;
let collegeId: string, classId: string, otherClassId: string, subjectId: string, termId: string, typeId: string, scaleId: string, studentId: string, assessmentId: string;
const suffix = randomUUID().slice(0, 8);
const academicYear = "2026-27";
const bands = [{ minPct: 80, grade: "A", points: 10 }, { minPct: 40, grade: "B", points: 5 }, { minPct: 0, grade: "F", points: 0 }];

async function create(route: string, body: unknown, params?: Record<string, string>) {
  const response = await stack.call(route, { cookie: admin, body, params });
  expect(response.status, `${route}: ${await response.clone().text()}`).toBe(201);
  return (await response.json()) as { id: string };
}
async function provision(subject: string) {
  const username = `sm-${randomUUID().slice(0, 8)}`;
  const user = await create("identity.user-create", { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] });
  const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId: user.id } });
  const { token } = await reset.json() as { token: string };
  expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: "school-marks-pass-123" } })).status).toBe(200);
  const person = await create("people.teacher-create", { collegeId, staffNo: username, fullName: username });
  expect((await stack.call("people.teacher-link-identity", { cookie: admin, params: { teacherId: person.id }, body: { identityUserId: user.id } })).status).toBe(200);
  await create("people.assignment-create", { classId, subjectId: subject, kind: "subject_teacher", academicYear }, { teacherId: person.id });
  return stack.login(username, "school-marks-pass-123");
}
beforeAll(async () => {
  stack = buildStack("school");
  const bootstrap = await stack.bootstrap();
  admin = bootstrap.adminCookie; collegeId = bootstrap.collegeId;
  const { departmentId } = await stack.people.service.ensureImplicitDepartment(collegeId);
  classId = (await create("people.class-create", { departmentId, name: `Standard ${suffix}`, code: `SM-${suffix}` })).id;
  otherClassId = (await create("people.class-create", { departmentId, name: `Other standard ${suffix}`, code: `SMO-${suffix}` })).id;
  const sectionId = (await create("people.section-create", { classId, name: "A" })).id;
  subjectId = (await create("people.subject-create", { departmentId, name: `Math ${suffix}`, code: `SM-M-${suffix}` })).id;
  const otherSubject = (await create("people.subject-create", { departmentId, name: `English ${suffix}`, code: `SM-E-${suffix}` })).id;
  studentId = (await create("people.student-create", { collegeId, admissionNo: `SM-${suffix}`, fullName: "Meera Nair" })).id;
  expect((await stack.call("people.student-enroll", { cookie: admin, body: { sectionId, academicYear }, params: { studentId } })).status).toBe(200);
  termId = (await create("school-academics.create", { collegeId, name: `Marks ${suffix}`, academicYear, startsOn: "2026-04-01", endsOn: "2027-03-31" })).id;
  const configured = await stack.call("school-academics.types-set", { cookie: admin, params: { termId }, body: { types: [{ name: "Exam", weight: 100 }] } });
  expect(configured.status).toBe(200);
  typeId = ((await configured.json()) as { types: { id: string }[] }).types[0]!.id;
  scaleId = (await create("results.scale-create", { collegeId, name: `School scale ${suffix}`, bands })).id;
  teacher = await provision(subjectId); otherTeacher = await provision(otherSubject);
});
afterAll(async () => { await stack?.close(); });
const assessmentBody = () => ({ classId, subjectId, termId, typeId, scaleId, name: "First test", maxScore: 20, heldOn: "2026-06-01" });
const save = (cookie: string, entries: { studentId: string; score: number; expectedScore?: number | null }[] = [{ studentId, score: 16 }]) => stack.call("school-academics.marks-enter", { cookie, params: { assessmentId }, body: { entries } });

describe("School assessments and marks with real authentication, scope and database guards", () => {
  it("requires authentication on every school marks route", async () => {
    const calls = [
      stack.call("school-academics.class-setup", { params: { classId }, query: { academicYear } }),
      stack.call("school-academics.assessments-list", { params: { classId }, query: { academicYear } }),
      stack.call("school-academics.assessment-create", { body: assessmentBody() }),
      stack.call("school-academics.marks-list", { params: { assessmentId: "missing" } }),
      stack.call("school-academics.marks-enter", { params: { assessmentId: "missing" }, body: { entries: [{ studentId, score: 1 }] } }),
    ];
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
  });

  it("denies class setup and assessment listing outside the teacher's assigned class", async () => {
    expect((await stack.call("school-academics.class-setup", { cookie: teacher, params: { classId: otherClassId }, query: { academicYear } })).status).toBe(403);
    expect((await stack.call("school-academics.assessments-list", { cookie: teacher, params: { classId: otherClassId }, query: { academicYear } })).status).toBe(403);
  });

  it("permits the assigned subject teacher, denying administrators and another subject's teacher", async () => {
    for (const cookie of [admin, otherTeacher]) expect((await stack.call("school-academics.assessment-create", { cookie, body: assessmentBody() })).status).toBe(403);
    const created = await stack.call("school-academics.assessment-create", { cookie: teacher, body: assessmentBody() });
    expect(created.status, await created.clone().text()).toBe(201);
    assessmentId = ((await created.json()) as { id: string }).id;
    expect((await stack.call("school-academics.marks-list", { cookie: otherTeacher, params: { assessmentId } })).status).toBe(403);
    expect((await save(otherTeacher)).status).toBe(403);
    expect((await save(admin)).status).toBe(403);
    const listed = await stack.call("school-academics.assessments-list", { cookie: otherTeacher, params: { classId }, query: { academicYear } });
    expect(await listed.json()).toEqual({ assessments: [] });
  });
  it("stores derived grades and rejects an invalid batch without partial updates", async () => {
    const result = await save(teacher);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({ marks: [{ studentId, score: 16, percentage: 80, grade: "A", points: 10 }] });
    expect((await save(teacher, [{ studentId, score: 2 }, { studentId: "outside-class", score: 10 }])).status).toBe(422);
    expect((await save(teacher, [{ studentId, score: 21 }])).status).toBe(422);
    const read = await stack.call("school-academics.marks-list", { cookie: teacher, params: { assessmentId } });
    expect(await read.json()).toMatchObject({ marks: [{ score: 16, grade: "A" }] });
    const audit = await stack.system.service.readAuditEventsForResource("assessment", assessmentId, 10);
    expect(audit.some((event) => event.action === "school-academics.marks-entered")).toBe(true);
  });
  it("rejects a stale CSV preview inside the term-locked marks transaction", async () => {
    expect((await save(teacher, [{ studentId, score: 18, expectedScore: 16 }])).status).toBe(200);
    const stale = await save(teacher, [{ studentId, score: 19, expectedScore: 16 }]);
    expect(stale.status).toBe(409);
    expect((await stale.json()) as { message: string }).toMatchObject({ message: expect.stringContaining("changed since the import preview") });
    const read = await stack.call("school-academics.marks-list", { cookie: teacher, params: { assessmentId } });
    expect(await read.json()).toMatchObject({ marks: [{ score: 18 }] });
    expect((await save(teacher, [{ studentId, score: 16, expectedScore: 18 }])).status).toBe(200);
  });
  it("keeps the grading basis immutable after use even if the source scale changes", async () => {
    const changed = await stack.call("results.scale-update", { cookie: admin, params: { scaleId }, body: { name: `Changed source ${suffix}`, bands: [{ minPct: 0, grade: "Changed", points: 1 }] } });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await (await save(teacher, [{ studentId, score: 17 }])).json()).toMatchObject({ marks: [{ score: 17, grade: "A" }] });
    expect((await stack.call("school-academics.types-set", { cookie: admin, params: { termId }, body: { types: [{ id: typeId, name: "Changed", weight: 100 }] } })).status).toBe(409);
    await expect(stack.pool.query("UPDATE sca_terms SET scale_name = 'Changed' WHERE id = $1", [termId])).rejects.toMatchObject({ code: "23514" });
  });
  it("locks corrections in both the API and database, allowing an audited reopening", async () => {
    expect((await stack.call("school-academics.close", { cookie: admin, params: { termId }, body: {} })).status).toBe(200);
    expect((await save(teacher)).status).toBe(409);
    await expect(stack.pool.query("UPDATE sca_marks SET score = 1 WHERE assessment_id = $1", [assessmentId])).rejects.toMatchObject({ code: "23514" });
    expect((await stack.call("school-academics.reopen", { cookie: admin, params: { termId }, body: { reason: "Approved correction after review" } })).status).toBe(200);
    expect(await (await save(teacher, [{ studentId, score: 10 }])).json()).toMatchObject({ marks: [{ score: 10, grade: "B", percentage: 50 }] });
  });
});
