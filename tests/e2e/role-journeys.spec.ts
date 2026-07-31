import { expect, request, test } from "@playwright/test";
import { type DemoIds, YEAR, apiSession, browserLogin, discover, pollReport } from "./support/fixtures";

/**
 * JOURNEYS 1-7 — each begins with a real login as the named role (browser
 * form for the UI landing, then real HTTP over that authenticated session via
 * page.request / an APIRequestContext). No in-process shortcuts.
 */

let ids: DemoIds;

test.beforeAll(async ({ baseURL }) => {
  const admin = await apiSession(baseURL!, "admin");
  ids = await discover(admin);
  await admin.dispose();
});

// ---------------------------------------------------------------------------
// 1. ADMIN: create user -> set password (the previously broken button) ->
//    the new user logs in with that password.
// ---------------------------------------------------------------------------
test("J1 admin creates a user, sets its password, and the user logs in", async ({ page, baseURL }) => {
  await browserLogin(page, "admin");
  await page.goto("/manage/users");
  await expect(page.getByRole("link", { name: /users/i }).first()).toBeVisible();

  const username = `e2e-user-${Date.now()}`;
  const created = await page.request.post("/api/v1/identity/users", {
    data: { username, displayName: "E2E User", collegeId: ids.collegeId, temporaryPassword: "TempPass-2026!x", roles: [] },
  });
  expect(created.status(), "create user").toBe(201);
  const { id: userId } = (await created.json()) as { id: string };

  // The endpoint behind the "Set password" button that used to 404.
  const newPassword = "NewPass-2026!e2e";
  const setPw = await page.request.post(`/api/v1/identity/users/${encodeURIComponent(userId)}/password`, {
    data: { newPassword },
  });
  expect(setPw.status(), "set password (formerly orphaned route)").toBe(200);

  const fresh = await request.newContext({ baseURL });
  const login = await fresh.post("/api/v1/identity/auth/login", { data: { username, password: newPassword } });
  expect(login.status(), "new user logs in with the set password").toBe(200);
  await fresh.dispose();
});

// ---------------------------------------------------------------------------
// 2. ADMIN: exam series -> slot -> class schedule -> hall-ticket PDF
//    (exercises exams <-> reporting over HTTP end-to-end).
// ---------------------------------------------------------------------------
test("J2 admin schedules an exam and generates a hall-ticket PDF", async ({ page }) => {
  await browserLogin(page, "admin");

  const series = await page.request.post("/api/v1/exams/series", {
    data: { collegeId: ids.collegeId, name: `E2E ${Date.now()}`, academicYear: YEAR, term: "1" },
  });
  expect(series.status(), "create exam series").toBe(201);
  const { id: seriesId } = (await series.json()) as { id: string };

  const slot = await page.request.post("/api/v1/exams/slots", {
    data: {
      seriesId,
      classId: ids.classId,
      subjectId: ids.ownSubjectId,
      onDate: "2026-12-01",
      starts: "10:00",
      ends: "12:00",
      room: "E2E-1",
    },
  });
  expect(slot.status(), "schedule an exam slot").toBe(201);

  const schedule = await page.request.get(
    `/api/v1/exams/classes/${encodeURIComponent(ids.classId)}/schedule?academicYear=${YEAR}`,
  );
  expect(schedule.status(), "class exam schedule").toBe(200);
  const { slots } = (await schedule.json()) as { slots: unknown[] };
  expect(slots.length, "schedule has the slot").toBeGreaterThan(0);

  const report = await page.request.post("/api/v1/reports", {
    data: { format: "pdf", academicYear: YEAR, report: { kind: "hall-ticket", studentId: ids.hallTicketStudentId } },
  });
  expect(report.status(), "request hall-ticket report").toBe(202);
  const { reportId } = (await report.json()) as { reportId: string };

  const ctx = page.request;
  const final = await pollReport(ctx, reportId);
  expect(final.status, "hall-ticket generated").toBe("completed");

  const pdf = await ctx.get(`/api/v1/reports/${encodeURIComponent(reportId)}/download`);
  expect(pdf.status(), "download hall-ticket").toBe(200);
  expect((await pdf.body()).length, "PDF has bytes").toBeGreaterThan(500);
});

// ---------------------------------------------------------------------------
// 3. TEACHER: record attendance for own subject; denied for another's.
// ---------------------------------------------------------------------------
test("J3 teacher records own-subject attendance and is denied another subject", async ({ page }) => {
  await browserLogin(page, "teacher");
  const entries = ids.sectionStudentIds.map((studentId) => ({ studentId, status: "present" as const }));

  const own = await page.request.post("/api/v1/academics/attendance/sessions", {
    data: { sectionId: ids.sectionId, subjectId: ids.ownSubjectId, heldOn: "2026-08-03", slot: "1", academicYear: YEAR, entries },
  });
  expect([200, 201, 409], "own subject accepted (409 if a rerun)").toContain(own.status());

  const other = await page.request.post("/api/v1/academics/attendance/sessions", {
    data: { sectionId: ids.sectionId, subjectId: ids.otherSubjectId, heldOn: "2026-08-03", slot: "2", academicYear: YEAR, entries },
  });
  expect(other.status(), "another teacher's subject denied").toBe(403);
});

// ---------------------------------------------------------------------------
// 4. CLASS_TEACHER: edit a student in own section; denied in another.
// ---------------------------------------------------------------------------
test("J4 class teacher edits own-section student and is denied another section", async ({ page }) => {
  await browserLogin(page, "classTeacher");

  const own = await page.request.fetch(`/api/v1/people/students/${encodeURIComponent(ids.sectionStudentIds[0]!)}`, {
    method: "PATCH",
    data: { fullName: "E2E Edited Student" },
  });
  expect(own.status(), "edit own-section student").toBe(200);

  const other = await page.request.fetch(
    `/api/v1/people/students/${encodeURIComponent(ids.otherSectionStudentId)}`,
    { method: "PATCH", data: { fullName: "Should Fail" } },
  );
  expect(other.status(), "edit another section denied").toBe(403);
});

// ---------------------------------------------------------------------------
// 5. STUDENT portal: attendance, marks, timetable, today, coursework, fees.
// ---------------------------------------------------------------------------
test("J5 student portal surfaces every self-scoped view (coursework non-empty post-#7)", async ({ page }) => {
  await browserLogin(page, "student");
  await expect(page).toHaveURL(/\/portal/);

  const get = async (path: string) => {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(200);
    return res.json();
  };
  await get("/api/v1/portal/me");
  await get(`/api/v1/portal/attendance?academicYear=${YEAR}`);
  await get(`/api/v1/portal/marks?academicYear=${YEAR}`);
  await get(`/api/v1/portal/timetable?academicYear=${YEAR}`);
  await get(`/api/v1/portal/today?academicYear=${YEAR}`);
  await get("/api/v1/fees/my-fees");

  const cw = (await get(`/api/v1/coursework/my/assignments?academicYear=${YEAR}`)) as { assignments: unknown[] };
  expect(cw.assignments.length, "coursework seeded by assignment #7").toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 6. ACCOUNTANT: land with Reports in nav; generate + download a PDF.
// ---------------------------------------------------------------------------
test("J6 accountant reaches Reports via nav and downloads a PDF", async ({ page }) => {
  await browserLogin(page, "accountant");
  // Part-3a fix: accountant now has a nav path to Reports.
  await expect(page.getByRole("link", { name: /reports/i }).first()).toBeVisible();

  const report = await page.request.post("/api/v1/reports", {
    data: { format: "pdf", academicYear: YEAR, report: { kind: "student-performance", studentId: ids.hallTicketStudentId } },
  });
  expect(report.status(), "accountant requests a report (college-wide read)").toBe(202);
  const { reportId } = (await report.json()) as { reportId: string };

  const final = await pollReport(page.request, reportId);
  expect(final.status).toBe("completed");
  const pdf = await page.request.get(`/api/v1/reports/${encodeURIComponent(reportId)}/download`);
  expect(pdf.status(), "download").toBe(200);
  expect((await pdf.body()).length).toBeGreaterThan(500);
});

// ---------------------------------------------------------------------------
// 7. LEAVE: teacher applies -> principal sees it pending -> decides ->
//    teacher sees the decision.
// ---------------------------------------------------------------------------
test("J7 leave request flows from teacher to principal decision", async ({ page, baseURL }) => {
  await browserLogin(page, "teacher");
  const applied = await page.request.post("/api/v1/leave/requests", {
    data: { fromOn: "2026-09-01", toOn: "2026-09-02", kind: "casual", reason: `E2E leave ${Date.now()}` },
  });
  expect(applied.status(), "teacher applies for leave").toBe(201);
  const { id: requestId } = (await applied.json()) as { id: string };

  const principal = await apiSession(baseURL!, "principal");
  const pending = await principal.get("/api/v1/leave/pending");
  expect(pending.status()).toBe(200);
  const pendingBody = (await pending.json()) as { requests: { id: string }[] };
  expect(pendingBody.requests.some((r) => r.id === requestId), "principal sees the request").toBeTruthy();

  const decided = await principal.post(`/api/v1/leave/requests/${encodeURIComponent(requestId)}/decide`, {
    data: { status: "approved" },
  });
  expect(decided.status(), "principal approves").toBe(200);
  await principal.dispose();

  const mine = await page.request.get("/api/v1/leave/mine");
  expect(mine.status()).toBe(200);
  const mineBody = (await mine.json()) as { requests: { id: string; status: string }[] };
  const row = mineBody.requests.find((r) => r.id === requestId);
  expect(row?.status, "teacher sees the approval").toBe("approved");
});
