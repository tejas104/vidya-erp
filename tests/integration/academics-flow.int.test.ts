import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { GAP_SCAN_JOB_NAME } from "@vidya/module-academics";
import { buildStack, type Stack } from "./support/harness";

/**
 * Academics end-to-end against the REAL security core and real Postgres:
 * class_teacher records attendance, the subject teacher enters marks, and
 * the live matrix draws exactly the lines the #4 worked traces promise —
 * including the cross-subject marks wall between two real logged-in
 * teachers, and the complete grade-change audit trail.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);
const log = pino({ level: "silent" });

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  mathId: "",
  physicsId: "",
  studentId: "",
  assessmentId: "",
  markId: "",
};

const PASSWORD = "academics-pass-123";
let mathCookie = "";
let physicsCookie = "";
let classTeacherCookie = "";

/** Creates identity user + teacher record + link + assignment; returns a session. */
async function provisionTeacher(
  username: string,
  staffNo: string,
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
      classId: ids.classId,
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

  // Org: department → class → section, two subjects.
  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Acad ${runId}`, code: `ACD-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const classResponse = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `AB1-${runId}` },
  });
  ids.classId = ((await classResponse.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;
  const math = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Mathematics", code: `MTH-${runId}` },
  });
  ids.mathId = ((await math.json()) as { id: string }).id;
  const physics = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Physics", code: `PHY-${runId}` },
  });
  ids.physicsId = ((await physics.json()) as { id: string }).id;

  // One enrolled student.
  const student = await stack.call("people.student-create", {
    cookie: adminCookie,
    body: { collegeId, admissionNo: `AC-${runId}`, fullName: "Meera Nair" },
  });
  ids.studentId = ((await student.json()) as { id: string }).id;
  await stack.call("people.student-enroll", {
    cookie: adminCookie,
    params: { studentId: ids.studentId },
    body: { sectionId: ids.sectionId, academicYear: "2026-27" },
  });

  // Three real teachers with derived grants (the #3 seam feeding #4).
  mathCookie = await provisionTeacher(`math-${runId}`, `TM-${runId}`, {
    kind: "subject_teacher",
    subjectId: ids.mathId,
  });
  physicsCookie = await provisionTeacher(`phys-${runId}`, `TP-${runId}`, {
    kind: "subject_teacher",
    subjectId: ids.physicsId,
  });
  classTeacherCookie = await provisionTeacher(`ct-${runId}`, `TC-${runId}`, {
    kind: "class_teacher",
  });
});

afterAll(async () => {
  await stack.close();
});

describe("attendance through the live matrix (subject-teacher revision)", () => {
  it("subject teacher records THEIR OWN period; another subject's is DENIED", async () => {
    // The core correction: a subject teacher marks their own subject's period.
    const ownPeriod = await stack.call("academics.attendance-record", {
      cookie: mathCookie,
      body: {
        sectionId: ids.sectionId,
        subjectId: ids.mathId,
        heldOn: "2026-07-06",
        slot: "p1",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "present" }],
      },
    });
    expect(ownPeriod.status).toBe(201);

    // ...but not a subject that isn't theirs — the scope wall holds.
    const otherSubject = await stack.call("academics.attendance-record", {
      cookie: mathCookie,
      body: {
        sectionId: ids.sectionId,
        subjectId: ids.physicsId,
        heldOn: "2026-07-06",
        slot: "p2",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "present" }],
      },
    });
    expect(otherSubject.status).toBe(403);
  });

  it("class_teacher records a whole-section session AND corrects a subject teacher's period", async () => {
    // A whole-section (non-subject) session — still the class teacher's.
    const recorded = await stack.call("academics.attendance-record", {
      cookie: classTeacherCookie,
      body: {
        sectionId: ids.sectionId,
        heldOn: "2026-07-07",
        slot: "day",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "absent" }],
      },
    });
    expect(recorded.status).toBe(201);

    // The math teacher's own period, which the class teacher will correct.
    const mathPeriod = await stack.call("academics.attendance-record", {
      cookie: mathCookie,
      body: {
        sectionId: ids.sectionId,
        subjectId: ids.mathId,
        heldOn: "2026-07-07",
        slot: "p1",
        academicYear: "2026-27",
        entries: [{ studentId: ids.studentId, status: "absent" }],
      },
    });
    expect(mathPeriod.status).toBe(201);
    const sessionId = ((await mathPeriod.json()) as { id: string }).id;

    // Correction authority: the class teacher fixes the subject teacher's
    // period (a subject record), with a durable before/after audit.
    const corrected = await stack.call("academics.attendance-correct", {
      cookie: classTeacherCookie,
      params: { sessionId, studentId: ids.studentId },
      body: { status: "late" },
    });
    expect(corrected.status).toBe(200);
    const audit = await stack.system.service.readRecentAuditEvents(10);
    const correction = audit.find((row) => row.action === "academics.attendance-corrected");
    expect(correction?.details).toMatchObject({ before: "absent", after: "late" });

    // The physics teacher can neither read nor correct the math period.
    const physicsRead = await stack.call("academics.attendance-session-get", {
      cookie: physicsCookie,
      params: { sessionId },
    });
    expect(physicsRead.status).toBe(403);
  });

  it("roster-attendance feeds the flashcards: per-student cards scoped to the caller's subject", async () => {
    const res = await stack.call("academics.section-roster-attendance", {
      cookie: mathCookie,
      params: { sectionId: ids.sectionId },
      query: { academicYear: "2026-27", subjectId: ids.mathId },
    });
    expect(res.status).toBe(200);
    const { cards } = (await res.json()) as {
      cards: { studentId: string; pct: number | null; total: number; recent: unknown[] }[];
    };
    const card = cards.find((c) => c.studentId === ids.studentId);
    expect(card).toBeDefined();
    // The math teacher marked this student's period(s) — so the card has real figures.
    expect(card!.total).toBeGreaterThan(0);
    expect(card!.pct).not.toBeNull();
    expect(card!.recent.length).toBeGreaterThan(0);
  });
});

describe("marks through the live matrix (the cross-subject wall)", () => {
  it("the subject teacher creates an assessment and enters the marksheet", async () => {
    const assessment = await stack.call("academics.assessment-create", {
      cookie: mathCookie,
      body: {
        classId: ids.classId,
        subjectId: ids.mathId,
        kind: "exam",
        name: "Midterm",
        academicYear: "2026-27",
        maxScore: 100,
      },
    });
    expect(assessment.status).toBe(201);
    ids.assessmentId = ((await assessment.json()) as { id: string }).id;

    const entered = await stack.call("academics.marks-enter", {
      cookie: mathCookie,
      params: { assessmentId: ids.assessmentId },
      body: { entries: [{ studentId: ids.studentId, score: 72 }] },
    });
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ created: 1, updated: 0, unchanged: 0 });

    const marks = await stack.call("academics.assessment-marks", {
      cookie: mathCookie,
      params: { assessmentId: ids.assessmentId },
    });
    const list = (await marks.json()) as { marks: { id: string; score: number }[] };
    expect(list.marks[0]?.score).toBe(72);
    ids.markId = list.marks[0]!.id;
  });

  it("the OTHER subject's teacher can neither read nor write these marks", async () => {
    expect(
      (
        await stack.call("academics.assessment-marks", {
          cookie: physicsCookie,
          params: { assessmentId: ids.assessmentId },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await stack.call("academics.marks-enter", {
          cookie: physicsCookie,
          params: { assessmentId: ids.assessmentId },
          body: { entries: [{ studentId: ids.studentId, score: 1 }] },
        })
      ).status,
    ).toBe(403);
    // Row-filtering: the physics teacher listing the student's marks sees nothing.
    const filtered = await stack.call("academics.student-marks", {
      cookie: physicsCookie,
      params: { studentId: ids.studentId },
      query: {},
    });
    expect(((await filtered.json()) as { marks: unknown[] }).marks).toHaveLength(0);
    // The class_teacher reads them (all subjects of their class) but cannot write.
    const ctRead = await stack.call("academics.student-marks", {
      cookie: classTeacherCookie,
      params: { studentId: ids.studentId },
      query: {},
    });
    expect(((await ctRead.json()) as { marks: unknown[] }).marks).toHaveLength(1);
    expect(
      (
        await stack.call("academics.marks-enter", {
          cookie: classTeacherCookie,
          params: { assessmentId: ids.assessmentId },
          body: { entries: [{ studentId: ids.studentId, score: 1 }] },
        })
      ).status,
    ).toBe(403);
  });

  it("admin reads marks for support but cannot write them", async () => {
    expect(
      (
        await stack.call("academics.assessment-marks", {
          cookie: adminCookie,
          params: { assessmentId: ids.assessmentId },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await stack.call("academics.mark-correct", {
          cookie: adminCookie,
          params: { markId: ids.markId },
          body: { score: 1 },
        })
      ).status,
    ).toBe(403);
  });

  it("grade changes build a complete, queryable audit trail", async () => {
    const corrected = await stack.call("academics.mark-correct", {
      cookie: mathCookie,
      params: { markId: ids.markId },
      body: { score: 80 },
    });
    expect(corrected.status).toBe(200);

    const history = await stack.call("academics.mark-history", {
      cookie: mathCookie,
      params: { markId: ids.markId },
    });
    expect(history.status).toBe(200);
    const body = (await history.json()) as {
      history: { action: string; details: Record<string, unknown> }[];
    };
    expect(body.history.map((event) => event.action)).toEqual([
      "academics.mark-corrected",
      "academics.marks-entered",
    ]);
    expect(body.history[0]?.details).toMatchObject({ before: 72, after: 80 });
    // And the other subject's teacher cannot see the history either.
    expect(
      (
        await stack.call("academics.mark-history", {
          cookie: physicsCookie,
          params: { markId: ids.markId },
        })
      ).status,
    ).toBe(403);
  });
});

describe("attendance gap scan (worker job)", () => {
  it("reports sections without a session for the day and audits", async () => {
    const result = await stack.academics.jobProcessors[GAP_SCAN_JOB_NAME]!(
      { date: "2030-01-01", source: "integration-test" },
      { logger: log, jobId: "job-gap", attempt: 1 },
    );
    expect(result).toBeUndefined();
    const audit = await stack.system.service.readRecentAuditEvents(10);
    const gap = audit.find((row) => row.action === "academics.attendance-gap-detected");
    expect(gap).toBeDefined();
    expect((gap?.details as { missingCount: number }).missingCount).toBeGreaterThanOrEqual(1);
  });
});
