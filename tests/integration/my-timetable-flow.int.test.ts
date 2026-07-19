import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * My Timetable (weekly self-view) against the REAL security core and real
 * Postgres: a teacher's own periods across the whole week, self-scoped via
 * the identity link exactly like my/today — and a 404 for a sign-in with
 * no teacher record.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);
const YEAR = "2026-27";

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  subjectId: "",
};

const PASSWORD = "my-timetable-pass-123";
let teacherCookie = "";
let unlinkedCookie = "";

async function provisionTeacher(username: string, staffNo: string): Promise<string> {
  const user = await stack.call("identity.user-create", {
    cookie: adminCookie,
    body: { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] },
  });
  const userId = ((await user.json()) as { id: string }).id;
  const reset = await stack.call("identity.password-reset-init", { cookie: adminCookie, params: { userId } });
  const { token } = (await reset.json()) as { token: string };
  await stack.call("identity.password-reset-confirm", { body: { token, newPassword: PASSWORD } });

  const teacher = await stack.call("people.teacher-create", {
    cookie: adminCookie,
    body: { collegeId, staffNo, fullName: username },
  });
  const teacherId = ((await teacher.json()) as { id: string }).id;
  await stack.call("people.teacher-link-identity", {
    cookie: adminCookie,
    params: { teacherId },
    body: { identityUserId: userId },
  });
  // An assignment derives the "teacher" role onto the identity user.
  const created = await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: { classId: ids.classId, subjectId: ids.subjectId, kind: "subject_teacher", academicYear: YEAR },
  });
  expect(created.status).toBe(201);

  // Schedule two entries on different weekdays for this teacher.
  const monEntry = await stack.call("timetable.entry-create", {
    cookie: adminCookie,
    body: {
      sectionId: ids.sectionId,
      subjectId: ids.subjectId,
      teacherId,
      room: "204",
      dayOfWeek: 1,
      periodNo: 1,
      academicYear: YEAR,
    },
  });
  expect(monEntry.status).toBe(201);
  const wedEntry = await stack.call("timetable.entry-create", {
    cookie: adminCookie,
    body: {
      sectionId: ids.sectionId,
      subjectId: ids.subjectId,
      teacherId,
      room: "205",
      dayOfWeek: 3,
      periodNo: 2,
      academicYear: YEAR,
    },
  });
  expect(wedEntry.status).toBe(201);

  return stack.login(username, PASSWORD);
}

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `MyTT ${runId}`, code: `MTT-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const classResponse = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `MTB1-${runId}` },
  });
  ids.classId = ((await classResponse.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;
  const subject = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Mathematics", code: `MTH-${runId}` },
  });
  ids.subjectId = ((await subject.json()) as { id: string }).id;

  teacherCookie = await provisionTeacher(`mytt-${runId}`, `TMT-${runId}`);

  // A sign-in with the "teacher" role but NO linked teacher record.
  const unlinkedUser = await stack.call("identity.user-create", {
    cookie: adminCookie,
    body: {
      username: `unlinked-${runId}`,
      displayName: "Unlinked",
      collegeId,
      temporaryPassword: "temporary-pass-123",
      roles: ["teacher"],
    },
  });
  const unlinkedUserId = ((await unlinkedUser.json()) as { id: string }).id;
  const unlinkedReset = await stack.call("identity.password-reset-init", {
    cookie: adminCookie,
    params: { userId: unlinkedUserId },
  });
  const { token: unlinkedToken } = (await unlinkedReset.json()) as { token: string };
  await stack.call("identity.password-reset-confirm", { body: { token: unlinkedToken, newPassword: PASSWORD } });
  unlinkedCookie = await stack.login(`unlinked-${runId}`, PASSWORD);
});

afterAll(async () => {
  await stack.close();
});

describe("timetable.my-week", () => {
  it("returns the teacher's periods across every day they teach", async () => {
    const res = await stack.call("timetable.my-week", {
      cookie: teacherCookie,
      query: { academicYear: YEAR },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { dayOfWeek: number; room: string }[] };
    const days = body.entries.map((e) => e.dayOfWeek).sort();
    expect(days).toEqual([1, 3]);
    expect(body.entries.map((e) => e.room).sort()).toEqual(["204", "205"]);
  });

  it("404s a sign-in with no linked teacher record", async () => {
    const res = await stack.call("timetable.my-week", {
      cookie: unlinkedCookie,
      query: { academicYear: YEAR },
    });
    expect(res.status).toBe(404);
  });
});
