import { describe, expect, it } from "vitest";
import type { Principal, RouteContext } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import { pino } from "pino";
import { createPortalHandlers } from "./handlers";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

const studentPrincipal: Principal = {
  id: "usr_1",
  kind: "user",
  displayName: "Aarav",
  roles: ["student"],
  scopes: [],
  grants: [],
  sessionId: "s",
};

const guardianPrincipal: Principal = { ...studentPrincipal, id: "usr_parent", kind: "guardian", roles: [] };

function ctx(principal: Principal, query: unknown = {}, params: unknown = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal,
    request: { params, query, body: undefined, headers: new Headers() },
  };
}

/** Minimal fakes: only the methods the portal touches are real. */
function makeDeps(opts: { linked: boolean; recordsThrough?: string }) {
  const directory = {
    studentByIdentityUser: async (identityUserId: string) =>
      opts.linked && identityUserId === "usr_1"
        ? { studentId: "stu_1", collegeId: "col_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001", status: "active" }
        : null,
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    sectionRoster: async () => [{ studentId: "stu_1", academicYear: YEAR }],
    namesFor: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, id === "sub_ds" ? "Data Structures" : `name:${id}`])),
  } as unknown as PeopleDirectory;

  const academicsRead = {
    studentAttendance: async () => [
      { entryId: "e1", studentId: "stu_1", status: "present", heldOn: "2026-06-01", recordedAt: "2026-06-01T10:00:00.000Z", academicYear: YEAR, position: {} },
      { entryId: "e2", studentId: "stu_1", status: "absent", heldOn: "2026-06-02", recordedAt: "2026-06-02T10:00:00.000Z", academicYear: YEAR, position: {} },
      { entryId: "e3", studentId: "stu_1", status: "late", heldOn: "2026-07-01", recordedAt: "2026-07-01T10:00:00.000Z", academicYear: YEAR, position: {} },
    ],
    studentMarks: async () => [
      {
        markId: "m1", studentId: "stu_1", scorePct: 80, kind: "quiz", assessmentName: "Quiz 1",
        heldOn: "2026-06-10", recordedAt: "2026-06-10", academicYear: YEAR,
        position: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_ds", kind: "quiz" },
      },
      {
        markId: "m2", studentId: "stu_1", scorePct: 60, kind: "exam", assessmentName: "Midterm",
        heldOn: "2026-07-01", recordedAt: "2026-07-01", academicYear: YEAR,
        position: { collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", subjectId: "sub_ds", kind: "exam" },
      },
    ],
  } as unknown as AcademicsReadModel;

  const timetableRead = {
    periods: async () => [{ periodNo: 1, starts: "09:00", ends: "09:50" }],
    sectionGrid: async () => [
      { id: "tte_1", sectionId: "sec_1", subjectId: "sub_ds", subjectName: "Data Structures", teacherId: "tch_1", teacherName: "Anita Desai", room: "204", dayOfWeek: 1, periodNo: 1 },
    ],
    sectionDay: async () => [],
    roomDay: async () => [],
  };

  // The parent of stu_1 may see attendance and timetable, not marks.
  const guardianAccess = async (identityUserId: string, studentId: string, category: string) =>
    identityUserId === "usr_parent" && studentId === "stu_1" && category !== "marks"
      ? { decision: { granted: true, reason: "granted:active-relationship" as const }, student: { studentId, collegeId: "col_1", fullName: "Aarav Sharma", admissionNo: "FYCS-001" }, recordsThrough: opts.recordsThrough ?? null }
      : { decision: { granted: false, reason: "denied:category-not-granted" as const }, student: null, recordsThrough: null };

  return { directory, academicsRead, timetableRead, guardianAccess };
}

describe("portal handlers (self-scoped via the identity link)", () => {
  it("answers 404 on every route for an unlinked student sign-in", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: false }));
    for (const id of ["portal.me", "portal.my-attendance", "portal.my-marks"]) {
      const result = await handlers[id]!(ctx(studentPrincipal, { academicYear: YEAR }));
      expect(result.status, id).toBe(404);
    }
  });

  it("me returns the linked student's profile + enrollment names", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const result = await handlers["portal.me"]!(ctx(studentPrincipal));
    expect(result.status).toBe(200);
    const body = result.body as { student: { fullName: string }; enrollment: { academicYear: string } };
    expect(body.student.fullName).toBe("Aarav Sharma");
    expect(body.enrollment.academicYear).toBe(YEAR);
  });

  it("my-attendance aggregates counts, pct and monthly buckets", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const result = await handlers["portal.my-attendance"]!(ctx(studentPrincipal, { academicYear: YEAR }));
    const body = result.body as { counts: Record<string, number>; pct: number; monthly: { month: string; pct: number }[] };
    expect(body.counts).toEqual({ present: 1, absent: 1, late: 1, excused: 0 });
    expect(body.pct).toBeCloseTo(66.7, 1); // present+late over 3
    expect(body.monthly).toEqual([
      { month: "2026-06", pct: 50 },
      { month: "2026-07", pct: 100 },
    ]);
  });

  it("my-marks groups by subject with resolved names and overall", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const result = await handlers["portal.my-marks"]!(ctx(studentPrincipal, { academicYear: YEAR }));
    const body = result.body as { subjects: { name: string; avgPct: number; marks: unknown[] }[]; overallPct: number };
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]!.name).toBe("Data Structures");
    expect(body.subjects[0]!.avgPct).toBe(70);
    expect(body.subjects[0]!.marks).toHaveLength(2);
    expect(body.overallPct).toBe(70);
  });
});

describe("family portal handlers (ADR-0027)", () => {
  const query = { academicYear: YEAR };

  it("shows a guardian the categories the adapter grants for their child", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const attendance = await handlers["portal.child-attendance"]!(ctx(guardianPrincipal, query, { studentId: "stu_1" }));
    expect(attendance.status).toBe(200);
    expect((attendance.body as { counts: Record<string, number> }).counts.present).toBe(1);
    const timetable = await handlers["portal.child-timetable"]!(ctx(guardianPrincipal, query, { studentId: "stu_1" }));
    expect((timetable.body as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it("refuses a withheld category and an unrelated child with the same 403", async () => {
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const marks = await handlers["portal.child-marks"]!(ctx(guardianPrincipal, query, { studentId: "stu_1" }));
    const stranger = await handlers["portal.child-attendance"]!(ctx(guardianPrincipal, query, { studentId: "stu_9" }));
    expect([marks.status, stranger.status]).toEqual([403, 403]);
    expect(marks.body).toEqual(stranger.body);
  });

  it("after the pupil left, shows a guardian only attendance recorded before the exit", async () => {
    // Entries e1 and e2 were recorded in June; e3 on 1 July, after live access ended.
    const handlers = createPortalHandlers(makeDeps({ linked: true, recordsThrough: "2026-06-30T00:00:00.000Z" }));
    const result = await handlers["portal.child-attendance"]!(ctx(guardianPrincipal, query, { studentId: "stu_1" }));
    expect(result.status).toBe(200);
    const body = result.body as { counts: Record<string, number>; sessions: { heldOn: string }[] };
    expect(body.counts).toEqual({ present: 1, absent: 1, late: 0, excused: 0 });
    expect(body.sessions.map((row) => row.heldOn)).toEqual(["2026-06-02", "2026-06-01"]);
  });

  it("never lets the self routes be driven by a path parameter", async () => {
    // A student passing another pupil's id still sees only their own record.
    const handlers = createPortalHandlers(makeDeps({ linked: true }));
    const result = await handlers["portal.my-attendance"]!(ctx(studentPrincipal, query, { studentId: "stu_9" }));
    expect(result.status).toBe(200);
    expect((result.body as { counts: Record<string, number> }).counts.present).toBe(1);
  });
});
