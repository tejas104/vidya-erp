import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  type College2Ids,
  type DemoIds,
  type RoleKey,
  YEAR,
  apiSession,
  discover,
  discoverCollege2,
} from "./support/fixtures";

/**
 * JOURNEY 8 — negative scope matrix.
 *
 * For each of the 7 roles, one representative forbidden action driven as a
 * real HTTP request (not merely a hidden button) must be denied with 403.
 * These are route-level role-gate denials: the pipeline authorizes before it
 * ever looks at a resource, so they are deterministic regardless of seed ids.
 */
type Forbidden = { method: "GET" | "POST"; path: string; why: string };

const MATRIX: Record<RoleKey, Forbidden> = {
  admin: { method: "GET", path: "/api/v1/portal/me", why: "admin is not a student (STUDENT_ONLY)" },
  principal: { method: "GET", path: "/api/v1/identity/users", why: "oversight is not user-admin (ADMIN_ONLY)" },
  hod: { method: "GET", path: "/api/v1/identity/users", why: "HOD cannot administer users (ADMIN_ONLY)" },
  teacher: { method: "GET", path: "/api/v1/identity/users", why: "teacher cannot administer users (ADMIN_ONLY)" },
  teacherOther: { method: "GET", path: "/api/v1/identity/users", why: "teacher cannot administer users (ADMIN_ONLY)" },
  classTeacher: {
    method: "GET",
    path: "/api/v1/exams/series?collegeId=x&academicYear=2026-27",
    why: "class teacher cannot run exams (ADMIN_ONLY)",
  },
  classTeacherOther: {
    method: "GET",
    path: "/api/v1/exams/series?collegeId=x&academicYear=2026-27",
    why: "class teacher cannot run exams (ADMIN_ONLY)",
  },
  student: { method: "GET", path: "/api/v1/identity/users", why: "student cannot administer users (ADMIN_ONLY)" },
  accountant: { method: "GET", path: "/api/v1/portal/marks", why: "accountant is not a student (STUDENT_ONLY)" },
};

test.describe("negative scope matrix (direct HTTP, not just hidden UI)", () => {
  for (const [role, forbidden] of Object.entries(MATRIX) as [RoleKey, Forbidden][]) {
    test(`${role} is denied 403: ${forbidden.why}`, async ({ baseURL }) => {
      const ctx = await apiSession(baseURL!, role);
      const res = await ctx.fetch(forbidden.path, { method: forbidden.method });
      expect(res.status(), `${role} ${forbidden.method} ${forbidden.path}`).toBe(403);
      await ctx.dispose();
    });
  }
});

/**
 * Part-2 regression guard (assignment #7): timetable.periods-get gained a
 * shared-ScopeChecker college-containment check. A college-level grant holder
 * (admin) still reads it; a caller with no covering grant (student) is now
 * denied 403 where it was previously an ANY_AUTHENTICATED 200. This is the
 * over-HTTP proof the containment is live. (A true cross-college admin denial
 * needs a second college the single-college demo seed does not provide; that
 * write-path containment is covered by timetable/handlers.test.ts.)
 */
test("timetable periods-get enforces college containment (admin 200, student 403)", async ({ baseURL }) => {
  const admin = await apiSession(baseURL!, "admin");
  const collegeId = await demoCollegeId(admin);

  const asAdmin = await admin.get(`/api/v1/timetable/colleges/${encodeURIComponent(collegeId)}/periods`);
  expect(asAdmin.status(), "admin (college grant) reads periods").toBe(200);

  const student = await apiSession(baseURL!, "student");
  const asStudent = await student.get(`/api/v1/timetable/colleges/${encodeURIComponent(collegeId)}/periods`);
  expect(asStudent.status(), "student (no covering grant) denied by containment").toBe(403);

  await admin.dispose();
  await student.dispose();
});

async function demoCollegeId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get("/api/v1/people/colleges");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { colleges: { id: string; code: string }[] };
  const demo = body.colleges.find((c) => c.code === "DEMO") ?? body.colleges[0];
  expect(demo, "seeded DEMO college").toBeTruthy();
  return demo!.id;
}

/**
 * JOURNEY 8b — CONTAINMENT matrix (Assignment #11.5 Part 1b).
 *
 * The MATRIX above proves route-level role gates: a role denied a route it
 * may never call at all. It says nothing about containment — whether a role
 * PERMITTED to call a route is stopped from reaching a record outside its
 * own scope — as this file's own top comment used to concede. Every case
 * below targets a route the role genuinely may call, aimed at a record
 * outside its scope: another college's data, or (for department/class/
 * section-scoped roles) another department's inside the SAME college.
 *
 * Two distinct security properties, asserted deliberately, never
 * interchanged — a case that would accept either proves neither:
 *   - "403"   — a single up-front scope gate on ONE named record
 *               (student-get, fee invoices, exam schedule, timetable write,
 *               leave decide, a report request, the notice board). The
 *               record exists; the caller may not reach it at all.
 *   - "empty" — a row-FILTERED list (academics.student-marks). The route
 *               answers 200 and a real row is silently absent rather than
 *               rejected. Only meaningful because the seed put a REAL row
 *               there for the filter to remove (seed commit 004614b: real
 *               marks entered for a college-2 student).
 *
 * Fixture (seed commit 004614b, do not rebuild): college 2 = Northgate
 * Junior College (DEMO2) — wholly separate roster, staff, real marks and a
 * pending leave request. "otherDept" = the MSC/FYMS decoy INSIDE college 1
 * — same section letter as FYCS-A, different department — so a role whose
 * scope is narrower than the whole college (hod/teacher/class_teacher) also
 * gets a same-college boundary to fail on, not only the cross-college one.
 *
 * Roles legitimately WITHOUT a narrower-than-college boundary (admin,
 * principal, accountant — all college-wide viewers by design; see
 * identity/core/scope-checker.ts's principal/admin/accountant cases) get no
 * "otherDept" row. Inventing one would only re-assert the college-wide
 * grant works, not test containment, so it is skipped with this comment
 * rather than padded into the table.
 *
 * Routes a role cannot call AT ALL belong to the role-gate MATRIX above,
 * not here (a 403 from the role gate proves nothing about containment).
 * Skipped for that reason, per resource — every role missing a row below
 * for one of these was excluded on purpose:
 *   - timetable write (ADMIN_ONLY, timetable/src/definition.ts): only
 *     admin gets a row.
 *   - notices.list (ADMIN_OR_PRINCIPAL): only admin/principal get a row.
 *     notices.visible (the route every other role CAN call) has no
 *     foreign-college parameter at all — it self-scopes from the caller's
 *     own grants (notices/src/handlers.ts `visible`) — so "read another
 *     college's notices" cannot even be expressed through it for anyone
 *     else; there is no case to add, not a hole.
 *   - leave.decide is ANY_AUTHENTICATED at the route, but teacher/
 *     class_teacher/student/accountant hold no covering grant to decide
 *     ANY leave request, even one in their own college (`covers()`,
 *     leave/src/handlers.ts:22-28 — a grant needs a matching college or
 *     department to pass). A cross-college attempt from one of these roles
 *     would be denied for the identical reason a same-college attempt is,
 *     proving role capability rather than org containment — excluded per
 *     the assignment's own instruction ("if a role cannot call a route at
 *     all, that combination belongs in the existing role-gate section").
 *     Only admin/principal/hod (the roles that CAN decide some leave
 *     request) get a row.
 *   - student gets no "otherDept" row: a role with zero grants (self-access
 *     only — identity/core/scope-checker.ts's `student` case) has no
 *     narrower-than-self boundary left to test beyond the cross-college row
 *     it already has.
 */

type ProbeExpect = { kind: "403" } | { kind: "empty"; field: string };

interface Probe {
  label: string;
  method: "GET" | "POST" | "PUT";
  path: (ids: DemoIds, c2: College2Ids) => string;
  body?: (ids: DemoIds, c2: College2Ids) => unknown;
  expect: ProbeExpect;
}

const P403: ProbeExpect = { kind: "403" };
const emptyField = (field: string): ProbeExpect => ({ kind: "empty", field });

const studentCrossCollege: Probe = {
  label: "people.student-get — a student in another college",
  method: "GET",
  path: (_ids, c2) => `/api/v1/people/students/${encodeURIComponent(c2.studentId)}`,
  // Single-record scope gate — people/src/api/handlers.ts `studentGet`.
  expect: P403,
};

const studentOtherDept: Probe = {
  label: "people.student-get — a student in another department, same college (MSC decoy)",
  method: "GET",
  path: (ids) => `/api/v1/people/students/${encodeURIComponent(ids.otherDeptStudentId)}`,
  expect: P403,
};

const marksCrossCollege: Probe = {
  label: "academics.student-marks — another college's real marks",
  method: "GET",
  path: (_ids, c2) => `/api/v1/academics/students/${encodeURIComponent(c2.studentId)}/marks`,
  // Row-filtered, not gated — academics/src/api/handlers.ts `studentMarks`
  // checks the student exists (globally) then filters marks per-row.
  expect: emptyField("marks"),
};

const feesCrossCollege: Probe = {
  label: "fees.student-invoices — another college's fee invoices",
  method: "GET",
  path: (_ids, c2) => `/api/v1/fees/students/${encodeURIComponent(c2.studentId)}/invoices`,
  // Single up-front gate (readAllowed), not row-filtered — fees/src/handlers.ts `studentInvoices`.
  expect: P403,
};

const examScheduleCrossCollege: Probe = {
  label: "exams.class-schedule — another college's exam schedule",
  method: "GET",
  path: (_ids, c2) => `/api/v1/exams/classes/${encodeURIComponent(c2.classId)}/schedule?academicYear=${YEAR}`,
  // orgOverlaps() single-record gate — exams/src/handlers.ts `classSchedule`.
  expect: P403,
};

const reportsCrossCollege: Probe = {
  label: "reporting.request — a report on another college's student",
  method: "POST",
  path: () => "/api/v1/reports",
  body: (_ids, c2) => ({
    format: "csv",
    academicYear: YEAR,
    report: { kind: "student-performance", studentId: c2.studentId },
  }),
  // canProduce() -> readModel.studentPerformance() "denied" (student exists
  // globally, zero visible rows) — reporting/src/report-data.ts.
  expect: P403,
};

const timetableEditCrossCollege: Probe = {
  label: "timetable.periods-set — write another college's period template",
  method: "PUT",
  path: (_ids, c2) => `/api/v1/timetable/colleges/${encodeURIComponent(c2.collegeId)}/periods`,
  body: () => ({ periods: [{ periodNo: 1, starts: "09:00", ends: "09:50" }] }),
  // outOfScope() — timetable/src/handlers.ts `periodsSet` (Part-2 regression
  // guard above proves the same gate on the read side; this is the write).
  expect: P403,
};

const leaveDecideCrossCollege: Probe = {
  label: "leave.decide — decide another college's pending leave request",
  method: "POST",
  path: (_ids, c2) => `/api/v1/leave/requests/${encodeURIComponent(c2.pendingLeaveRequestId)}/decide`,
  body: () => ({ status: "approved" as const }),
  // covers() — leave/src/handlers.ts `decide`.
  expect: P403,
};

const noticesCrossCollege: Probe = {
  label: "notices.list — another college's notice board (manage view)",
  method: "GET",
  path: (_ids, c2) => `/api/v1/notices?collegeId=${encodeURIComponent(c2.collegeId)}`,
  // inCollege() — notices/src/handlers.ts `list`.
  expect: P403,
};

const resultsCrossCollege: Probe = {
  label: "results.class-results — another college's class results preview",
  method: "GET",
  path: (_ids, c2) =>
    `/api/v1/results/classes/${encodeURIComponent(c2.classId)}/preview?academicYear=${YEAR}&scaleId=containment-probe-no-such-scale`,
  // Single up-front gate — results/src/handlers.ts `resolveClassAndScale`'s
  // readAllowed() check (shared by classResults/publish). It runs BEFORE the
  // scale is looked up, so a nonexistent scaleId still proves containment
  // rather than a 404 on the scale.
  expect: P403,
};

/** Per role: every resource its route auth permits it to attempt, aimed at
 *  a record outside its own scope. See the file-header comment above for
 *  what is excluded from each role's row and why. */
const CONTAINMENT: Partial<Record<RoleKey, Probe[]>> = {
  admin: [
    studentCrossCollege,
    timetableEditCrossCollege,
    leaveDecideCrossCollege,
    marksCrossCollege,
    feesCrossCollege,
    examScheduleCrossCollege,
    reportsCrossCollege,
    noticesCrossCollege,
    resultsCrossCollege,
  ],
  principal: [
    studentCrossCollege,
    leaveDecideCrossCollege,
    marksCrossCollege,
    feesCrossCollege,
    examScheduleCrossCollege,
    reportsCrossCollege,
    noticesCrossCollege,
    resultsCrossCollege,
  ],
  hod: [
    studentCrossCollege,
    studentOtherDept,
    leaveDecideCrossCollege,
    marksCrossCollege,
    feesCrossCollege,
    examScheduleCrossCollege,
    reportsCrossCollege,
  ],
  teacher: [studentCrossCollege, studentOtherDept, marksCrossCollege, feesCrossCollege, examScheduleCrossCollege, reportsCrossCollege],
  classTeacher: [
    studentCrossCollege,
    studentOtherDept,
    marksCrossCollege,
    feesCrossCollege,
    examScheduleCrossCollege,
    reportsCrossCollege,
  ],
  student: [studentCrossCollege, marksCrossCollege, feesCrossCollege, examScheduleCrossCollege, reportsCrossCollege],
  accountant: [studentCrossCollege, marksCrossCollege, feesCrossCollege, examScheduleCrossCollege, reportsCrossCollege],
};

test.describe("negative scope matrix — containment (permitted route, wrong record)", () => {
  let ids: DemoIds;
  let c2: College2Ids;

  test.beforeAll(async ({ baseURL }) => {
    const admin = await apiSession(baseURL!, "admin");
    ids = await discover(admin);
    await admin.dispose();
    c2 = await discoverCollege2(baseURL!);
  });

  /**
   * One test() per (role, probe) — NOT one test looping every probe for a
   * role. A loop aborts on its first failed assertion, so every probe after
   * a failure is silently never issued: mutation testing proved this
   * concretely — 3 probes (studentOtherDept for hod/teacher/classTeacher)
   * could never be observed failing, because studentCrossCollege precedes
   * them and shares the same chokepoint, so the loop died before their
   * fetch was ever made. That is the "green suite hiding unrun checks"
   * pattern. Splitting makes every probe independently observable
   * regardless of what else in the row passes or fails.
   *
   * Login cost stays one per role, not one per probe: a per-role
   * `test.describe` opens the session in `beforeAll` and disposes it in
   * `afterAll`, shared by every probe test nested inside. 7 roles x 1 login
   * each stays well under the per-username rate limiter no matter how many
   * probes a role ends up with.
   */
  for (const [role, probes] of Object.entries(CONTAINMENT) as [RoleKey, Probe[]][]) {
    test.describe(`${role}: containment across ${probes.length} resource(s) outside its scope`, () => {
      let ctx: APIRequestContext;

      test.beforeAll(async ({ baseURL }) => {
        ctx = await apiSession(baseURL!, role);
      });

      test.afterAll(async () => {
        await ctx.dispose();
      });

      for (const probe of probes) {
        test(probe.label, async () => {
          const res = await ctx.fetch(probe.path(ids, c2), { method: probe.method, data: probe.body?.(ids, c2) });
          if (probe.expect.kind === "403") {
            expect(res.status(), `${role} — ${probe.label}`).toBe(403);
          } else {
            expect(res.status(), `${role} — ${probe.label} (expected 200 + filtered-empty)`).toBe(200);
            const json = (await res.json()) as Record<string, unknown[]>;
            expect(json[probe.expect.field], `${role} — ${probe.label} (filtered-empty)`).toEqual([]);
          }
        });
      }
    });
  }
});
