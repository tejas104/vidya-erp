import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { REPORT_JOB_NAME } from "@vidya/module-reporting";
import { buildStack, type Stack } from "./support/harness";

/**
 * Reporting end-to-end against the REAL stack (Postgres + MinIO + the human-
 * owned scope matrix). Proves the three security-critical controls of #6 on
 * live infrastructure:
 *   1. a report is a disclosure surface — generation runs with the requester's
 *      scope snapshot, and an out-of-scope target is refused at request time;
 *   2. the download is scope-checked, not URL-secret — only the requester can
 *      fetch the artifact (a URL guess by another real user gets 403);
 *   3. CSV cells are formula-injection-escaped — a student whose real name
 *      begins with "=" cannot become a spreadsheet formula on open.
 */

let stack: Stack;
let collegeId = "";
let adminCookie = "";
const runId = randomUUID().slice(0, 8);
const log = pino({ level: "silent" });
const YEAR = "2026-27";
const PASSWORD = "reporting-pass-123";

const ids = {
  departmentId: "",
  classId: "",
  sectionId: "",
  mathId: "",
  otherClassId: "",
  otherSectionId: "",
  injectedStudentId: "",
  outsiderStudentId: "",
};
let mathCookie = "";
let classTeacherCookie = "";

/** identity user + teacher record + link + assignment → a live session cookie. */
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
  const created = await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: {
      classId: ids.classId,
      ...(assignment.subjectId !== undefined ? { subjectId: assignment.subjectId } : {}),
      kind: assignment.kind,
      academicYear: YEAR,
    },
  });
  expect(created.status).toBe(201);
  return stack.login(username, PASSWORD);
}

async function createStudent(admissionNo: string, fullName: string, sectionId: string): Promise<string> {
  const student = await stack.call("people.student-create", {
    cookie: adminCookie,
    body: { collegeId, admissionNo, fullName },
  });
  const studentId = ((await student.json()) as { id: string }).id;
  const enroll = await stack.call("people.student-enroll", {
    cookie: adminCookie,
    params: { studentId },
    body: { sectionId, academicYear: YEAR },
  });
  expect(enroll.status).toBe(200);
  return studentId;
}

/** Runs the worker job that generates + uploads the artifact (what BullMQ would call). */
async function generate(reportId: string): Promise<void> {
  await stack.reporting.jobProcessors[REPORT_JOB_NAME]!(
    { reportId, source: "integration-test" },
    { logger: log, jobId: `job-${reportId}`, attempt: 1 },
  );
}

beforeAll(async () => {
  stack = buildStack();
  const bootstrap = await stack.bootstrap();
  collegeId = bootstrap.collegeId;
  adminCookie = bootstrap.adminCookie;

  // Org: department → class → section, plus a sibling class the math teacher
  // will NOT be assigned to (the out-of-scope target).
  const dept = await stack.call("people.department-create", {
    cookie: adminCookie,
    body: { collegeId, name: `Rpt ${runId}`, code: `RPT-${runId}` },
  });
  ids.departmentId = ((await dept.json()) as { id: string }).id;
  const klass = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 1", code: `RB1-${runId}` },
  });
  ids.classId = ((await klass.json()) as { id: string }).id;
  const section = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.classId, name: "A" },
  });
  ids.sectionId = ((await section.json()) as { id: string }).id;
  const math = await stack.call("people.subject-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "Mathematics", code: `RMTH-${runId}` },
  });
  ids.mathId = ((await math.json()) as { id: string }).id;

  const otherClass = await stack.call("people.class-create", {
    cookie: adminCookie,
    body: { departmentId: ids.departmentId, name: "BSc Year 2", code: `RB2-${runId}` },
  });
  ids.otherClassId = ((await otherClass.json()) as { id: string }).id;
  const otherSection = await stack.call("people.section-create", {
    cookie: adminCookie,
    body: { classId: ids.otherClassId, name: "A" },
  });
  ids.otherSectionId = ((await otherSection.json()) as { id: string }).id;

  // Teachers: a math subject teacher and a class teacher on the roster class.
  mathCookie = await provisionTeacher(`rpt-math-${runId}`, `RTM-${runId}`, {
    kind: "subject_teacher",
    subjectId: ids.mathId,
  });
  classTeacherCookie = await provisionTeacher(`rpt-ct-${runId}`, `RTC-${runId}`, { kind: "class_teacher" });

  // Six students enrolled in the roster section (>= the minimum cohort of 5).
  // Student #1's real name is a formula-injection payload — the CSV must neutralise it.
  ids.injectedStudentId = await createStudent(`RA-${runId}-1`, "=Ravi Injection", ids.sectionId);
  const others: string[] = [ids.injectedStudentId];
  for (let i = 2; i <= 6; i++) {
    others.push(await createStudent(`RA-${runId}-${i}`, `Student ${i}`, ids.sectionId));
  }
  // A student in the sibling class the math teacher cannot see (out-of-scope target).
  ids.outsiderStudentId = await createStudent(`RB-${runId}-1`, "Outsider Student", ids.otherSectionId);

  // Attendance recorded by the class teacher; marks entered by the math teacher.
  await stack.call("academics.attendance-record", {
    cookie: classTeacherCookie,
    body: {
      sectionId: ids.sectionId,
      heldOn: "2026-07-06",
      slot: "day",
      academicYear: YEAR,
      entries: others.map((studentId, index) => ({
        studentId,
        status: index === 0 ? "absent" : "present",
      })),
    },
  });
  const assessment = await stack.call("academics.assessment-create", {
    cookie: mathCookie,
    body: { classId: ids.classId, subjectId: ids.mathId, kind: "exam", name: "Midterm", academicYear: YEAR, maxScore: 100 },
  });
  const assessmentId = ((await assessment.json()) as { id: string }).id;
  await stack.call("academics.marks-enter", {
    cookie: mathCookie,
    params: { assessmentId },
    body: { entries: others.map((studentId, index) => ({ studentId, score: 40 + index * 8 })) },
  });
});

afterAll(async () => {
  await stack.close();
});

describe("report generation + scoped download (the real stack)", () => {
  it("requests, generates in the worker, and downloads a PDF artifact", async () => {
    const request = await stack.call("reporting.request", {
      cookie: adminCookie,
      body: { format: "pdf", academicYear: YEAR, report: { kind: "student-performance", studentId: ids.injectedStudentId } },
    });
    expect(request.status).toBe(202);
    const { reportId } = (await request.json()) as { reportId: string };
    expect(stack.enqueuedReports.at(-1)?.reportId).toBe(reportId);

    await generate(reportId);

    const status = await stack.call("reporting.status", { cookie: adminCookie, params: { reportId } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { status: string }).status).toBe("completed");

    const download = await stack.call("reporting.download", { cookie: adminCookie, params: { reportId } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/attachment/);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("escapes formula-injection in the CSV export (a name starting with '=')", async () => {
    const request = await stack.call("reporting.request", {
      cookie: adminCookie,
      body: { format: "csv", academicYear: YEAR, report: { kind: "student-performance", studentId: ids.injectedStudentId } },
    });
    const { reportId } = (await request.json()) as { reportId: string };
    await generate(reportId);

    const download = await stack.call("reporting.download", { cookie: adminCookie, params: { reportId } });
    expect(download.status).toBe(200);
    const text = await download.text();

    // The dangerous name is present but neutralised with a leading apostrophe,
    // and NO field is left as a live formula (no line begins with =, +, - or @).
    expect(text).toContain("'=Ravi Injection");
    for (const line of text.split(/\r?\n/)) {
      expect(/^[=+\-@]/.test(line)).toBe(false);
    }
  });

  it("lets only the requester download the artifact (a URL guess by another user is 403)", async () => {
    const request = await stack.call("reporting.request", {
      cookie: adminCookie,
      body: { format: "pdf", academicYear: YEAR, report: { kind: "student-performance", studentId: ids.injectedStudentId } },
    });
    const { reportId } = (await request.json()) as { reportId: string };
    await generate(reportId);

    // The math teacher is a real, authenticated user — but not the requester.
    const intruder = await stack.call("reporting.download", { cookie: mathCookie, params: { reportId } });
    expect(intruder.status).toBe(403);
    // The requester still gets it.
    expect((await stack.call("reporting.download", { cookie: adminCookie, params: { reportId } })).status).toBe(200);
  });

  it("refuses a report whose target is outside the caller's scope (403 at request time)", async () => {
    // The math teacher can read none of the sibling-class student's records.
    const before = stack.enqueuedReports.length;
    const request = await stack.call("reporting.request", {
      cookie: mathCookie,
      body: { format: "pdf", academicYear: YEAR, report: { kind: "student-performance", studentId: ids.outsiderStudentId } },
    });
    expect(request.status).toBe(403);
    // A refused request enqueues no generation job.
    expect(stack.enqueuedReports.length).toBe(before);
  });

  it("generates a scoped report for a non-admin requester (class teacher, section attendance)", async () => {
    const request = await stack.call("reporting.request", {
      cookie: classTeacherCookie,
      body: { format: "csv", academicYear: YEAR, report: { kind: "section-attendance", sectionId: ids.sectionId } },
    });
    expect(request.status).toBe(202);
    const { reportId } = (await request.json()) as { reportId: string };
    await generate(reportId);
    const download = await stack.call("reporting.download", { cookie: classTeacherCookie, params: { reportId } });
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("Section attendance report");
  });
});
