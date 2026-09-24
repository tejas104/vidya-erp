import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let adminCookie = "";
let collegeId = "";
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;
});
afterAll(async () => { await stack.close(); });

describe("Student 360 through real routes and PostgreSQL", () => {
  it("keeps ended enrollments and status audit while enforcing the current pupil scope", async () => {
    const callAdmin = (route: string, body?: unknown, params?: Record<string, string>) =>
      stack.call(route, { cookie: adminCookie, body, params });
    const createdId = async (route: string, body: unknown, params?: Record<string, string>) => {
      const response = await callAdmin(route, body, params);
      expect(response.status, route).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };

    const departmentId = await createdId("people.department-create", { collegeId, name: `Student 360 ${suffix}`, code: `S36-${suffix}` });
    const ownClass = await createdId("people.class-create", { departmentId, name: "Standard Eight", code: `S8-${suffix}` });
    const otherClass = await createdId("people.class-create", { departmentId, name: "Standard Nine", code: `S9-${suffix}` });
    const firstSection = await createdId("people.section-create", { classId: ownClass, name: "A" });
    const currentSection = await createdId("people.section-create", { classId: ownClass, name: "B" });
    const otherSection = await createdId("people.section-create", { classId: otherClass, name: "A" });
    const studentId = await createdId("people.student-create", { collegeId, admissionNo: `S36-${suffix}`, fullName: "Meera Record" });
    const otherStudentId = await createdId("people.student-create", { collegeId, admissionNo: `S36-O-${suffix}`, fullName: "Other Pupil" });
    expect((await callAdmin("people.student-enroll", { sectionId: firstSection, academicYear: "2026-27" }, { studentId })).status).toBe(200);
    expect((await callAdmin("people.student-enroll", { sectionId: currentSection, academicYear: "2026-27" }, { studentId })).status).toBe(200);
    expect((await callAdmin("people.student-enroll", { sectionId: otherSection, academicYear: "2026-27" }, { studentId: otherStudentId })).status).toBe(200);
    expect((await callAdmin("people.student-update", { status: "backlog" }, { studentId })).status).toBe(200);

    const profile = await callAdmin("people.student-get", undefined, { studentId });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      fullName: "Meera Record", admissionNo: `S36-${suffix}`, status: "backlog",
      enrollment: { sectionId: currentSection, className: "Standard Eight", sectionName: "B", academicYear: "2026-27" },
    });
    const history = await callAdmin("people.student-history", undefined, { studentId });
    expect(history.status).toBe(200);
    const body = (await history.json()) as {
      enrollments: { sectionId: string; status: string }[];
      statusChanges: { from: string; to: string }[];
      events: { action: string }[];
    };
    expect(body.enrollments).toEqual(expect.arrayContaining([
      expect.objectContaining({ sectionId: firstSection, status: "withdrawn" }),
      expect.objectContaining({ sectionId: currentSection, status: "enrolled" }),
    ]));
    expect(body.statusChanges).toContainEqual(expect.objectContaining({ from: "active", to: "backlog" }));
    expect(body.events.map((event) => event.action)).toEqual(expect.arrayContaining([
      "people.student-created", "people.student-enrolled", "people.student-updated",
    ]));
    expect(body.events.every((event) => !("details" in event))).toBe(true);

    const username = `s36-teacher-${suffix}`;
    const password = "student-360-teacher-pass";
    const userId = await createdId("identity.user-create", {
      collegeId, username, displayName: "Class teacher", temporaryPassword: "temporary-pass-123", roles: [],
    });
    const reset = await callAdmin("identity.password-reset-init", undefined, { userId });
    const { token } = (await reset.json()) as { token: string };
    expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: password } })).status).toBe(200);
    const teacherId = await createdId("people.teacher-create", { collegeId, staffNo: `S36-T-${suffix}`, fullName: "Class teacher" });
    expect((await callAdmin("people.teacher-link-identity", { identityUserId: userId }, { teacherId })).status).toBe(200);
    expect((await callAdmin("people.assignment-create", { classId: ownClass, kind: "class_teacher", academicYear: "2026-27" }, { teacherId })).status).toBe(201);
    const teacherCookie = await stack.login(username, password);
    expect((await stack.call("people.student-get", { cookie: teacherCookie, params: { studentId } })).status).toBe(200);
    expect((await stack.call("people.student-history", { cookie: teacherCookie, params: { studentId } })).status).toBe(200);
    expect((await stack.call("people.student-get", { cookie: teacherCookie, params: { studentId: otherStudentId } })).status).toBe(403);
    expect((await stack.call("people.student-history", { cookie: teacherCookie, params: { studentId: otherStudentId } })).status).toBe(403);

    const accountantUsername = `s36-accountant-${suffix}`;
    const accountantPassword = "student-360-accountant-pass";
    const accountantId = await createdId("identity.user-create", {
      collegeId, username: accountantUsername, displayName: "School accountant",
      temporaryPassword: "temporary-pass-123", roles: ["accountant"],
    });
    const accountantGrant = await callAdmin("identity.grant-add", { role: "accountant", collegeId }, { userId: accountantId });
    expect(accountantGrant.status).toBe(201);
    const accountantReset = await callAdmin("identity.password-reset-init", undefined, { userId: accountantId });
    const accountantToken = ((await accountantReset.json()) as { token: string }).token;
    expect((await stack.call("identity.password-reset-confirm", { body: { token: accountantToken, newPassword: accountantPassword } })).status).toBe(200);
    const accountantCookie = await stack.login(accountantUsername, accountantPassword);
    expect((await stack.call("people.student-get", { cookie: accountantCookie, params: { studentId } })).status).toBe(200);
  });
});
