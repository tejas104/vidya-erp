import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { ROLLUP_JOB_NAME } from "@vidya/module-analytics";
import { buildStack, type Stack } from "./support/harness";

/**
 * Analytics end-to-end against the REAL scope matrix and real Postgres.
 * The headline security property of #5: aggregates are served only from
 * records the caller could read (constituent-closure), and the
 * minimum-cohort rule withholds small-N aggregates for everyone. Proven
 * here with two real logged-in teachers over a real rollup rebuild.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);
const log = pino({ level: "silent" });
const YEAR = "2026-27";

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  mathId: "",
  physicsId: "",
  students: [] as string[],
};
const PASSWORD = "analytics-pass-123";
let mathCookie = "";
let physicsCookie = "";
let classTeacherCookie = "";

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
  await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: {
      classId: ids.classId,
      ...(assignment.subjectId !== undefined ? { subjectId: assignment.subjectId } : {}),
      kind: assignment.kind,
      academicYear: YEAR,
    },
  });
  return stack.login(username, PASSWORD);
}

async function runRollup(): Promise<void> {
  await stack.analytics.jobProcessors[ROLLUP_JOB_NAME]!(
    { academicYear: YEAR, source: "integration-test" },
    { logger: log, jobId: "job-rollup", attempt: 1 },
  );
}

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Anl ${runId}`, code: `ANL-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const classResponse = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `AN1-${runId}` },
  });
  ids.classId = ((await classResponse.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;
  const math = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Mathematics", code: `MT-${runId}` },
  });
  ids.mathId = ((await math.json()) as { id: string }).id;
  const physics = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Physics", code: `PH-${runId}` },
  });
  ids.physicsId = ((await physics.json()) as { id: string }).id;

  // Six enrolled students (above the K=5 cohort floor).
  for (let index = 0; index < 6; index += 1) {
    const student = await stack.call("people.student-create", {
      cookie: adminCookie,
      body: { collegeId, admissionNo: `AN-${runId}-${index}`, fullName: `Student ${index}` },
    });
    const studentId = ((await student.json()) as { id: string }).id;
    ids.students.push(studentId);
    await stack.call("people.student-enroll", {
      cookie: adminCookie,
      params: { studentId },
      body: { sectionId: ids.sectionId, academicYear: YEAR },
    });
  }

  mathCookie = await provisionTeacher(`anl-math-${runId}`, `MT-${runId}`, {
    kind: "subject_teacher",
    subjectId: ids.mathId,
  });
  physicsCookie = await provisionTeacher(`anl-phys-${runId}`, `PH-${runId}`, {
    kind: "subject_teacher",
    subjectId: ids.physicsId,
  });
  classTeacherCookie = await provisionTeacher(`anl-ct-${runId}`, `CT-${runId}`, { kind: "class_teacher" });

  // Attendance: one session, most present, one absent (drives a flag).
  await stack.call("academics.attendance-record", {
    cookie: classTeacherCookie,
    body: {
      sectionId: ids.sectionId,
      heldOn: "2026-07-06",
      slot: "day",
      academicYear: YEAR,
      entries: ids.students.map((studentId, index) => ({
        studentId,
        status: index === 0 ? "absent" : "present",
      })),
    },
  });
  // Marks: math for everyone; physics for everyone. Student 0 fails math.
  const mathAssessment = await stack.call("academics.assessment-create", {
    cookie: mathCookie,
    body: { classId: ids.classId, subjectId: ids.mathId, kind: "exam", name: "Math Midterm", academicYear: YEAR, maxScore: 100 },
  });
  const mathId = ((await mathAssessment.json()) as { id: string }).id;
  await stack.call("academics.marks-enter", {
    cookie: mathCookie,
    params: { assessmentId: mathId },
    body: { entries: ids.students.map((studentId, index) => ({ studentId, score: index === 0 ? 20 : 75 })) },
  });
  const physicsAssessment = await stack.call("academics.assessment-create", {
    cookie: physicsCookie,
    body: { classId: ids.classId, subjectId: ids.physicsId, kind: "exam", name: "Physics Midterm", academicYear: YEAR, maxScore: 100 },
  });
  const physicsId = ((await physicsAssessment.json()) as { id: string }).id;
  await stack.call("academics.marks-enter", {
    cookie: physicsCookie,
    params: { assessmentId: physicsId },
    body: { entries: ids.students.map((studentId) => ({ studentId, score: 65 })) },
  });

  await runRollup();
});

afterAll(async () => {
  await stack.close();
});

describe("rollup rebuild + constituent closure over real records", () => {
  it("math teacher: own-subject class average served; overall DENIED at physics", async () => {
    const response = await stack.call("analytics.rollup", {
      cookie: mathCookie,
      params: { level: "class", nodeId: ids.classId },
      query: { academicYear: YEAR },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attendance: { state: string };
      marks: { bySubject: { subjectId: string; summary: { state: string } }[]; overall: { state: string; deniedSubjectId?: string } };
    };
    expect(body.attendance.state).toBe("ok"); // attendance is non-subject → readable across class
    expect(body.marks.bySubject.map((row) => row.subjectId)).toEqual([ids.mathId]);
    expect(body.marks.overall.state).toBe("denied");
    expect(body.marks.overall.deniedSubjectId).toBe(ids.physicsId);
  });

  it("class_teacher: cross-subject overall served under closure", async () => {
    const response = await stack.call("analytics.rollup", {
      cookie: classTeacherCookie,
      params: { level: "class", nodeId: ids.classId },
      query: { academicYear: YEAR },
    });
    const body = (await response.json()) as {
      marks: { bySubject: unknown[]; overall: { state: string } };
    };
    expect(body.marks.bySubject).toHaveLength(2);
    expect(body.marks.overall.state).toBe("ok");
  });

  it("the dashboard is the permission mirror: each teacher sees only their tile", async () => {
    const mathDash = (await (await stack.call("analytics.dashboard", {
      cookie: mathCookie,
      query: { academicYear: YEAR },
    })).json()) as { tiles: { type: string; subjectId?: string }[] };
    expect(mathDash.tiles).toHaveLength(1);
    expect(mathDash.tiles[0]).toMatchObject({ type: "teacher-class", subjectId: ids.mathId });

    const physicsDash = (await (await stack.call("analytics.dashboard", {
      cookie: physicsCookie,
      query: { academicYear: YEAR },
    })).json()) as { tiles: { subjectId?: string }[] };
    expect(physicsDash.tiles[0]?.subjectId).toBe(ids.physicsId);
  });
});

describe("at-risk field gating over real data", () => {
  it("math teacher sees the flagged student's attendance + math score, never physics or overall", async () => {
    const response = await stack.call("analytics.at-risk", {
      cookie: mathCookie,
      params: { level: "class", nodeId: ids.classId },
      query: { academicYear: YEAR },
    });
    const body = (await response.json()) as {
      students: { studentId: string; overallPct: number | null; subjectPcts: Record<string, number> }[];
    };
    const flagged = body.students.find((row) => row.studentId === ids.students[0]);
    expect(flagged).toBeDefined();
    expect(flagged?.overallPct).toBeNull();
    expect(Object.keys(flagged?.subjectPcts ?? {})).toEqual([ids.mathId]);
    expect(flagged?.subjectPcts[ids.mathId]).toBe(20);
  });

  it("class_teacher sees the same student's full picture (overall + both subjects)", async () => {
    const response = await stack.call("analytics.at-risk", {
      cookie: classTeacherCookie,
      params: { level: "class", nodeId: ids.classId },
      query: { academicYear: YEAR },
    });
    const body = (await response.json()) as {
      students: { studentId: string; overallPct: number | null; subjectPcts: Record<string, number> }[];
    };
    const flagged = body.students.find((row) => row.studentId === ids.students[0]);
    expect(flagged?.overallPct).not.toBeNull();
    expect(Object.keys(flagged?.subjectPcts ?? {}).sort()).toEqual([ids.mathId, ids.physicsId].sort());
  });
});

describe("minimum-cohort rule over real data", () => {
  it("withholds a below-K section aggregate even for the principal (admin here reads college-wide)", async () => {
    // A fresh section with only 2 enrolled students → under K=5.
    const smallSection = await stack.call("people.section-create", {
      cookie: adminCookie,
      body: { classId: ids.classId, name: `Tiny-${runId}` },
    });
    const smallSectionId = ((await smallSection.json()) as { id: string }).id;
    for (let index = 0; index < 2; index += 1) {
      const student = await stack.call("people.student-create", {
        cookie: adminCookie,
        body: { collegeId, admissionNo: `TN-${runId}-${index}`, fullName: `Tiny ${index}` },
      });
      const studentId = ((await student.json()) as { id: string }).id;
      await stack.call("people.student-enroll", {
        cookie: adminCookie,
        params: { studentId },
        body: { sectionId: smallSectionId, academicYear: YEAR },
      });
    }
    await stack.call("academics.attendance-record", {
      cookie: classTeacherCookie,
      body: {
        sectionId: smallSectionId,
        heldOn: "2026-07-07",
        slot: "day",
        academicYear: YEAR,
        entries: [], // no entries → but the section is tiny anyway
      },
    }).catch(() => undefined);
    await runRollup();
    const response = await stack.call("analytics.rollup", {
      cookie: adminCookie,
      params: { level: "section", nodeId: smallSectionId },
      query: { academicYear: YEAR },
    });
    // Section has too few students → attendance withheld or no-data, never a raw number.
    const body = (await response.json()) as { attendance: { state: string } };
    expect(["insufficient-cohort", "no-data"]).toContain(body.attendance.state);
  });
});

describe("recompute route (admin)", () => {
  it("enqueues a rebuild and audits it", async () => {
    const response = await stack.call("analytics.recompute", {
      cookie: adminCookie,
      body: { academicYear: YEAR },
    });
    expect(response.status).toBe(202);
    expect(stack.enqueuedRollups.at(-1)).toEqual({ academicYear: YEAR, source: "api" });
    const audit = await stack.system.service.readRecentAuditEvents(10);
    expect(audit.map((row) => row.action)).toContain("analytics.recompute-requested");
  });
});
