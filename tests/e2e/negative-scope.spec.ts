import { type APIRequestContext, expect, test } from "@playwright/test";
import { type RoleKey, apiSession } from "./support/fixtures";

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
