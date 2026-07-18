import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

/**
 * Recent-corrections queue end-to-end against the REAL security core and
 * real Postgres: a class teacher records a section session then corrects
 * an entry; the section-corrections queue surfaces it with the right
 * before/after and student.
 *
 * The endpoint's scope gate is deliberately coarse — ONE checkScope on the
 * section's own (non-subject) path, the same pattern as section-attendance
 * — so it reads like a section-level view, not a per-correction one. A
 * subject teacher WITHIN this class/section (any subject) legitimately
 * passes that gate (the real matrix grants "read" on non-subject records to
 * any teacher grant covering the org path); the wall that actually holds is
 * for a teacher who holds no grant on this section at all — e.g. a subject
 * teacher provisioned on an entirely different class.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  studentId: "",
  otherDepartmentId: "",
  otherClassId: "",
  subjectAId: "",
  subjectBId: "",
};

const PASSWORD = "corrections-pass-123";
let classTeacherCookie = "";
let outsiderCookie = "";
let subjectATeacherCookie = "";
let subjectBTeacherCookie = "";

async function provisionTeacher(
  username: string,
  staffNo: string,
  classId: string,
  assignment: { kind: "subject_teacher" | "class_teacher"; subjectId?: string },
): Promise<string> {
  const user = await stack.call("identity.user-create", {
    cookie: adminCookie,
    body: { username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: [] },
  });
  const userId = ((await user.json()) as { id: string }).id;
  const reset = await stack.call("identity.password-reset-init", {
    cookie: adminCookie,
    params: { userId },
  });
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
  const created = await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: {
      classId,
      ...(assignment.subjectId !== undefined ? { subjectId: assignment.subjectId } : {}),
      kind: assignment.kind,
      academicYear: "2026-27",
    },
  });
  expect(created.status).toBe(201);
  return stack.login(username, PASSWORD);
}

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Corr ${runId}`, code: `COR-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const classResponse = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `CB1-${runId}` },
  });
  ids.classId = ((await classResponse.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;

  const student = await stack.call("people.student-create", {
    cookie: adminCookie,
    body: { collegeId, admissionNo: `CR-${runId}`, fullName: "Asha Verma" },
  });
  ids.studentId = ((await student.json()) as { id: string }).id;
  await stack.call("people.student-enroll", {
    cookie: adminCookie,
    params: { studentId: ids.studentId },
    body: { sectionId: ids.sectionId, academicYear: "2026-27" },
  });

  // A second, unrelated department/class — the outsider teacher below is
  // provisioned only here, so they hold no grant covering ids.sectionId.
  const otherDept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Corr-Other ${runId}`, code: `COX-${runId}` },
  });
  ids.otherDepartmentId = ((await otherDept.json()) as { id: string }).id;
  const otherClass = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.otherDepartmentId, name: "BSc Year 2", code: `CB2-${runId}` },
  });
  ids.otherClassId = ((await otherClass.json()) as { id: string }).id;
  const otherPhysics = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.otherDepartmentId, name: "Physics", code: `COP-${runId}` },
  });
  const otherPhysicsId = ((await otherPhysics.json()) as { id: string }).id;

  // Two subjects WITHIN this section's own class — used to prove a
  // same-section, different-subject teacher can't see the other subject's
  // correction history (the outer section gate is coarse; the row filter
  // must do the real work).
  const subjectA = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Chemistry", code: `CHE-${runId}` },
  });
  ids.subjectAId = ((await subjectA.json()) as { id: string }).id;
  const subjectB = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Biology", code: `BIO-${runId}` },
  });
  ids.subjectBId = ((await subjectB.json()) as { id: string }).id;

  classTeacherCookie = await provisionTeacher(`ct-${runId}`, `TCC-${runId}`, ids.classId, {
    kind: "class_teacher",
  });
  outsiderCookie = await provisionTeacher(`phys-${runId}`, `TCP-${runId}`, ids.otherClassId, {
    kind: "subject_teacher",
    subjectId: otherPhysicsId,
  });
  subjectATeacherCookie = await provisionTeacher(`chem-${runId}`, `TCA-${runId}`, ids.classId, {
    kind: "subject_teacher",
    subjectId: ids.subjectAId,
  });
  subjectBTeacherCookie = await provisionTeacher(`bio-${runId}`, `TCB-${runId}`, ids.classId, {
    kind: "subject_teacher",
    subjectId: ids.subjectBId,
  });
});

afterAll(async () => {
  await stack.close();
});

describe("section-corrections queue (audit-log-derived)", () => {
  it("surfaces a class teacher's own correction with the right before/after and student", async () => {
    const recorded = await stack.call("academics.attendance-record", {
      cookie: classTeacherCookie,
      body: {
        sectionId: ids.sectionId,
        heldOn: "2026-07-08",
        slot: "day",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "absent" }],
      },
    });
    expect(recorded.status).toBe(201);
    const sessionId = ((await recorded.json()) as { id: string }).id;

    const corrected = await stack.call("academics.attendance-correct", {
      cookie: classTeacherCookie,
      params: { sessionId, studentId: ids.studentId },
      body: { status: "present" },
    });
    expect(corrected.status).toBe(200);

    const queue = await stack.call("academics.section-corrections", {
      cookie: classTeacherCookie,
      params: { sectionId: ids.sectionId },
      query: { limit: "50" },
    });
    expect(queue.status).toBe(200);
    const body = (await queue.json()) as {
      corrections: { sessionId: string; studentId: string; studentName: string; before: string; after: string }[];
    };
    const entry = body.corrections.find(
      (c) => c.sessionId === sessionId && c.studentId === ids.studentId,
    );
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ before: "absent", after: "present", studentName: "Asha Verma" });
  });

  it("denies a subject teacher with no grant on this section — the scope wall holds", async () => {
    const denied = await stack.call("academics.section-corrections", {
      cookie: outsiderCookie,
      params: { sectionId: ids.sectionId },
      query: { limit: "50" },
    });
    expect(denied.status).toBe(403);
  });

  it("404s an unknown section", async () => {
    const missing = await stack.call("academics.section-corrections", {
      cookie: classTeacherCookie,
      params: { sectionId: "sec_ghost" },
      query: { limit: "50" },
    });
    expect(missing.status).toBe(404);
  });

  it("row-filters per session subject: a same-section, different-subject teacher can't see another subject's correction", async () => {
    // Subject A's own period, corrected — this is the record that must stay hidden from subject B.
    const subjectASession = await stack.call("academics.attendance-record", {
      cookie: subjectATeacherCookie,
      body: {
        sectionId: ids.sectionId,
        subjectId: ids.subjectAId,
        heldOn: "2026-07-09",
        slot: "p1",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "absent" }],
      },
    });
    expect(subjectASession.status).toBe(201);
    const sessionId = ((await subjectASession.json()) as { id: string }).id;

    const corrected = await stack.call("academics.attendance-correct", {
      cookie: subjectATeacherCookie,
      params: { sessionId, studentId: ids.studentId },
      body: { status: "present" },
    });
    expect(corrected.status).toBe(200);

    // Subject B teacher: same section, different subject — passes the
    // coarse outer (non-subject) section gate, since the real matrix grants
    // "read" on non-subject records to any teacher grant covering the org
    // path, but must NOT see subject A's correction once row-filtered.
    const queue = await stack.call("academics.section-corrections", {
      cookie: subjectBTeacherCookie,
      params: { sectionId: ids.sectionId },
      query: { limit: "50" },
    });
    expect(queue.status).toBe(200);
    const body = (await queue.json()) as { corrections: { sessionId: string }[] };
    expect(body.corrections.some((c) => c.sessionId === sessionId)).toBe(false);
  });
});
