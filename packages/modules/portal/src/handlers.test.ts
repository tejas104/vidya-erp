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

function ctx(principal: Principal, query: unknown = {}): RouteContext {
  return {
    requestId: "req-1",
    logger,
    principal,
    request: { params: {}, query, body: undefined, headers: new Headers() },
  };
}

/** Minimal fakes: only the methods the portal touches are real. */
function makeDeps(opts: { linked: boolean }) {
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
      { entryId: "e1", studentId: "stu_1", status: "present", heldOn: "2026-06-01", academicYear: YEAR, position: {} },
      { entryId: "e2", studentId: "stu_1", status: "absent", heldOn: "2026-06-02", academicYear: YEAR, position: {} },
      { entryId: "e3", studentId: "stu_1", status: "late", heldOn: "2026-07-01", academicYear: YEAR, position: {} },
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

  return { directory, academicsRead };
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
