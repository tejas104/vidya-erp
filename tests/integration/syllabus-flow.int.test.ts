import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * Syllabus end-to-end against the REAL security core and Postgres: a subject
 * teacher authors units + topics for THEIR subject and marks coverage; the
 * derived coverage % is exact; a DIFFERENT subject's teacher is walled off on
 * write and row-filtered out on read; and a linked student of the class reads
 * their own syllabus (GET /syllabus/my) with the same coverage. No auth is
 * weakened to pass — every actor goes through the legitimate login/link flow.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);
const YEAR = "2026-27";
const PASSWORD = "syllabus-pass-123";

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  dsId: "",
  mthId: "",
  studentId: "",
  unitId: "",
};

let dsCookie = ""; // teacher of Data Structures (S1)
let mthCookie = ""; // teacher of Discrete Mathematics (S2)
let studentCookie = "";

async function provisionTeacher(
  username: string,
  staffNo: string,
  subjectId: string,
): Promise<string> {
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
  const assigned = await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: { classId: ids.classId, subjectId, kind: "subject_teacher", academicYear: YEAR },
  });
  expect(assigned.status).toBe(201);
  return stack.login(username, PASSWORD);
}

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Syl ${runId}`, code: `SYL-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const cls = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "FY CS", code: `FYS-${runId}` },
  });
  ids.classId = ((await cls.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;
  const ds = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Data Structures", code: `DS-${runId}` },
  });
  ids.dsId = ((await ds.json()) as { id: string }).id;
  const mth = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Discrete Mathematics", code: `MTH-${runId}` },
  });
  ids.mthId = ((await mth.json()) as { id: string }).id;

  // One enrolled student, linked to a real student sign-in.
  const student = await stack.call("people.student-create", {
    cookie: adminCookie,
    body: { collegeId, admissionNo: `SY-${runId}`, fullName: "Meera Nair" },
  });
  ids.studentId = ((await student.json()) as { id: string }).id;
  await stack.call("people.student-enroll", {
    cookie: adminCookie,
    params: { studentId: ids.studentId },
    body: { sectionId: ids.sectionId, academicYear: YEAR },
  });
  const studentUser = await stack.call("identity.user-create", {
    cookie: adminCookie,
    body: { username: `stud-${runId}`, displayName: "Meera Nair", collegeId, temporaryPassword: "temporary-pass-123", roles: ["student"] },
  });
  const studentUserId = ((await studentUser.json()) as { id: string }).id;
  const sReset = await stack.call("identity.password-reset-init", { cookie: adminCookie, params: { userId: studentUserId } });
  const { token: sToken } = (await sReset.json()) as { token: string };
  await stack.call("identity.password-reset-confirm", { body: { token: sToken, newPassword: PASSWORD } });
  await stack.call("people.student-link-identity", {
    cookie: adminCookie,
    params: { studentId: ids.studentId },
    body: { identityUserId: studentUserId },
  });
  studentCookie = await stack.login(`stud-${runId}`, PASSWORD);

  dsCookie = await provisionTeacher(`ds-${runId}`, `TDS-${runId}`, ids.dsId);
  mthCookie = await provisionTeacher(`mth-${runId}`, `TMT-${runId}`, ids.mthId);
});

afterAll(async () => {
  await stack.close();
});

describe("syllabus authoring + coverage through the live scope matrix", () => {
  it("the subject teacher authors a unit + topics and marks one taught; coverage is exact", async () => {
    const unit = await stack.call("syllabus.unit-create", {
      cookie: dsCookie,
      body: { classId: ids.classId, subjectId: ids.dsId, academicYear: YEAR, title: "Unit 1 — Foundations", position: 0 },
    });
    expect(unit.status).toBe(201);
    ids.unitId = ((await unit.json()) as { id: string }).id;

    const topicA = await stack.call("syllabus.topic-create", {
      cookie: dsCookie,
      params: { unitId: ids.unitId },
      body: { title: "Arrays & complexity", position: 0 },
    });
    expect(topicA.status).toBe(201);
    const topicAId = ((await topicA.json()) as { id: string }).id;

    const topicB = await stack.call("syllabus.topic-create", {
      cookie: dsCookie,
      params: { unitId: ids.unitId },
      body: { title: "Linked lists", position: 1 },
    });
    expect(topicB.status).toBe(201);

    // Mark exactly one of two topics taught → derived coverage is 50%.
    const covered = await stack.call("syllabus.topic-coverage", {
      cookie: dsCookie,
      params: { topicId: topicAId },
      body: { taughtOn: "2026-07-01" },
    });
    expect(covered.status).toBe(200);
    expect((await covered.json()).taughtOn).toBe("2026-07-01");

    const view = await stack.call("syllabus.class-syllabus", {
      cookie: dsCookie,
      params: { classId: ids.classId },
      query: { academicYear: YEAR },
    });
    expect(view.status).toBe(200);
    const body = (await view.json()) as { units: { subjectId: string; coveragePct: number; topics: unknown[] }[] };
    const dsUnit = body.units.find((u) => u.subjectId === ids.dsId);
    expect(dsUnit).toBeDefined();
    expect(dsUnit!.topics).toHaveLength(2);
    expect(dsUnit!.coveragePct).toBe(50);
  });

  it("another subject's teacher is DENIED on write and row-filtered out on read", async () => {
    // The Maths teacher cannot author against the DS subject.
    const denied = await stack.call("syllabus.unit-create", {
      cookie: mthCookie,
      body: { classId: ids.classId, subjectId: ids.dsId, academicYear: YEAR, title: "Sneak unit", position: 0 },
    });
    expect(denied.status).toBe(403);

    // ...and reading the class syllabus, the DS unit is filtered out for them.
    const view = await stack.call("syllabus.class-syllabus", {
      cookie: mthCookie,
      params: { classId: ids.classId },
      query: { academicYear: YEAR },
    });
    expect(view.status).toBe(200);
    const body = (await view.json()) as { units: { subjectId: string }[] };
    expect(body.units.some((u) => u.subjectId === ids.dsId)).toBe(false);
  });

  it("a linked student of the class reads their own syllabus with coverage", async () => {
    const mine = await stack.call("syllabus.my", {
      cookie: studentCookie,
      query: { academicYear: YEAR },
    });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as { subjects: { subjectId: string; subjectName: string; coveragePct: number }[] };
    const ds = body.subjects.find((s) => s.subjectId === ids.dsId);
    expect(ds).toBeDefined();
    expect(ds!.subjectName).toBe("Data Structures");
    expect(ds!.coveragePct).toBe(50);
  });
});
