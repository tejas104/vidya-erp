/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

/**
 * The report-card desk, end to end in a real browser against the isolated
 * school stack: an examination in-charge picks a term and class, previews a
 * pupil whose marks are incomplete, is warned rather than shown an invented
 * figure, completes the marks, generates a permanent snapshot and downloads
 * the PDF.
 *
 * The journey deliberately walks the INCOMPLETE state first. A report card
 * that quietly turns a missing mark into a zero is the failure this feature
 * exists to prevent, so the browser must be shown refusing to do it.
 *
 * The administrator issues the first snapshot, then the class teacher uses
 * the same desk and sees only their assigned class. This checks the browser
 * bootstrap as well as the server's per-pupil authorization.
 */
test("examination in-charge previews, is warned about missing marks, then issues a report card", async ({ page, baseURL }, testInfo) => {
  const admin = await apiSession(baseURL!, {
    username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
    password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
  });
  const suffix = Date.now().toString(36);
  const academicYear = "2026-27";
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id: string };
  };

  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
    const departmentId = departments[0]!.id;

    const { id: classId } = await post("/api/v1/people/classes", { departmentId, name: `Standard report ${suffix}`, code: `RB-${suffix}` });
    const { id: sectionId } = await post("/api/v1/people/sections", { classId, name: "A" });
    const { id: subjectId } = await post("/api/v1/people/subjects", { departmentId, name: `Math report ${suffix}`, code: `RBM-${suffix}` });
    const { id: studentId } = await post("/api/v1/people/students", { collegeId, admissionNo: `RB-${suffix}`, fullName: "Asha Browser" });
    await post(`/api/v1/people/students/${studentId}/enrollment`, { sectionId, academicYear });

    const { id: termId } = await post("/api/v1/school/terms", {
      collegeId,
      name: `Browser report ${suffix}`,
      academicYear,
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
    });
    expect(
      (await admin.put(`/api/v1/school/terms/${termId}/assessment-types`, { data: { types: [{ name: "Exam", weight: 100 }] } })).ok(),
    ).toBe(true);
    const { id: scaleId } = await post("/api/v1/results/scales", {
      collegeId,
      name: `Report scale ${suffix}`,
      bands: [
        { minPct: 80, grade: "A", points: 10 },
        { minPct: 0, grade: "B", points: 5 },
      ],
    });

    // A teacher who owns the subject, so the assessment and its marks are
    // created by the role that really does it.
    const username = `report-browser-${suffix}`;
    const password = "report-browser-pass-123";
    const { id: userId } = await post("/api/v1/identity/users", { collegeId, username, displayName: "Report teacher", temporaryPassword: password, roles: [] });
    const { token } = (await (await admin.post(`/api/v1/identity/users/${userId}/password-reset`)).json()) as { token: string };
    await post("/api/v1/identity/auth/password-reset/confirm", { token, newPassword: password });
    const { id: teacherId } = await post("/api/v1/people/teachers", { collegeId, fullName: "Report teacher", staffNo: `RT-${suffix}` });
    expect((await admin.post(`/api/v1/people/teachers/${teacherId}/identity-link`, { data: { identityUserId: userId } })).ok()).toBe(true);
    await post(`/api/v1/people/teachers/${teacherId}/assignments`, { classId, subjectId, academicYear, kind: "subject_teacher" });
    await post(`/api/v1/people/teachers/${teacherId}/assignments`, { classId, academicYear, kind: "class_teacher" });

    const teacher = await apiSession(baseURL!, { username, password });
    const adminUsername = process.env.SCHOOL_E2E_USERNAME ?? "int-admin";
    const adminPassword = process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1";
    const { id: assessmentId } = (await (
      await teacher.post("/api/v1/school/assessments", {
        data: { classId, subjectId, termId, typeId: (await (await admin.get(`/api/v1/school/classes/${classId}/setup?academicYear=${academicYear}`)).json() as { terms: { id: string; types: { id: string }[] }[] }).terms.find((term) => term.id === termId)!.types[0]!.id, scaleId, name: "Unit test", maxScore: 20, heldOn: "2026-06-02" },
      })
    ).json()) as { id: string };

    await browserLogin(page, { username: adminUsername, password: adminPassword });
    await page.goto("/manage/report-cards");
    await expect(page.getByRole("heading", { name: "Report card desk", level: 1 })).toBeVisible();

    // Help must resolve to the SCHOOL article, not a college fallback.
    await page.getByRole("button", { name: "Help" }).click();
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();

    await page.getByLabel("Term").selectOption(termId);
    await page.getByLabel("Class").selectOption(classId);

    const pupil = page.getByRole("button", { name: /Asha Browser/ });
    await expect(pupil).toBeVisible();
    await expect(pupil.getByText("Not generated")).toBeVisible();
    await pupil.click();

    // INCOMPLETE FIRST: the mark was never entered, so the desk must warn and
    // must not show a percentage for the subject.
    await expect(page.getByText("Needs review")).toBeVisible();
    await expect(page.getByText("Review before generating")).toBeVisible();
    await expect(page.getByText("Incomplete marks")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("report-card-incomplete.png"), fullPage: true });

    // Enter the mark, reload the preview: 18/20 at 100% weight is 90% → A.
    expect((await teacher.put(`/api/v1/school/assessments/${assessmentId}/marks`, { data: { entries: [{ studentId, score: 18 }] } })).ok()).toBe(true);
    await page.reload();
    await page.getByLabel("Term").selectOption(termId);
    await page.getByLabel("Class").selectOption(classId);
    await page.getByRole("button", { name: /Asha Browser/ }).click();
    // 18/20 at 100% weight is 90%, band A. The same string appears twice —
    // once on the subject row and once as the overall — so this asserts the
    // count rather than picking one and hiding a regression in the other.
    await expect(page.getByText("90.0% · A")).toHaveCount(2);

    // Attendance was never taken, so this card is still not fully complete —
    // generating must go through the explicit confirmation rather than
    // silently issuing over a gap.
    await page.getByRole("button", { name: "Generate report card" }).click();
    const confirm = page.getByRole("dialog", { name: "Generate with incomplete data" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("does not treat missing values as zero");
    await confirm.getByRole("button", { name: "Generate with warnings" }).click();

    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Asha Browser/ }).getByText("Private draft")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("report-card-generated.png"), fullPage: true });

    // The download must be a real PDF served to the browser session.
    const href = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
    expect(href).toMatch(/\/api\/v1\/school\/report-cards\/.+\/download$/);
    const snapshotId = href!.match(/report-cards\/([^/]+)\/download$/)![1]!;
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // A generated snapshot stays private until school leadership reviews the
    // issued PDF and explicitly releases that exact snapshot.
    await page.getByRole("button", { name: "Publish to family" }).click();
    const publish = page.getByRole("dialog", { name: "Publish report card to family" });
    await expect(publish).toContainText("this exact snapshot");
    await publish.getByRole("button", { name: "Publish to family" }).click();
    await expect(page.getByRole("button", { name: /Asha Browser/ }).getByText("Published")).toBeVisible();

    // Responsive and both themes, matching the other school journeys.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".shell-side")).not.toBeInViewport();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-report-cards.png`), fullPage: true });
    }

    await page.context().clearCookies();
    await browserLogin(page, { username, password });
    await page.goto("/manage/report-cards");
    await expect(page.getByRole("heading", { name: "Report card desk", level: 1 })).toBeVisible();
    await page.getByLabel("Term").selectOption(termId);
    const classPicker = page.getByLabel("Class");
    await expect(classPicker.locator("option")).toHaveCount(2);
    await classPicker.selectOption(classId);
    await page.getByRole("button", { name: /Asha Browser/ }).click();
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish to family" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Withdraw family access" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("class-teacher-report-card-desk.png"), fullPage: true });

    // A family member sees the released snapshot, then loses it on withdrawal
    // without any session reset or change to the underlying school record.
    const invitation = await admin.post(`/api/v1/people/students/${studentId}/guardian-invitations`, {
      data: { guardianName: "Leela Browser", relationshipType: "parent", contactMethod: "email", contactValue: `leela-${suffix}@example.test` },
    });
    expect(invitation.status()).toBe(201);
    const { code } = (await invitation.json()) as { code: string };
    const familyUsername = `family-report-${suffix}`;
    const familyPassword = "family-report-pass-123";
    const activation = await page.request.post("/api/v1/people/guardian-invitations/activate", {
      data: { code, fullName: "Leela Browser", username: familyUsername, password: familyPassword },
    });
    expect(activation.status(), await activation.text()).toBe(201);
    await page.context().clearCookies();
    await browserLogin(page, { username: familyUsername, password: familyPassword });
    await page.goto("/family");
    const learning = page.getByRole("navigation", { name: "Family sections" }).getByRole("button", { name: "Learning" });
    await learning.click();
    await expect(page.getByRole("heading", { name: "Report cards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Marks", exact: true })).toHaveCount(0);
    const termMarks = page.getByRole("region", { name: "School term marks" });
    await expect(termMarks.getByText("No term marks released yet.")).toBeVisible();
    const familyReport = page.getByRole("region", { name: "Report cards" });
    await expect(familyReport.getByText(`Browser report ${suffix}`)).toBeVisible();
    const familyDownload = familyReport.getByRole("link", { name: "Download PDF" });
    const familyPdf = await page.request.get((await familyDownload.getAttribute("href"))!);
    expect(familyPdf.status()).toBe(200);
    expect((await familyPdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await page.screenshot({ path: testInfo.outputPath("family-published-report-card.png"), fullPage: true });
    expect((await admin.post(`/api/v1/school/terms/${termId}/close`, { data: {} })).status()).toBe(200);
    await page.reload();
    await learning.click();
    await expect(termMarks.getByText("90.00%")).toHaveCount(2);
    await expect(termMarks.getByText("1 of 1 marks recorded")).toBeVisible();
    await termMarks.getByText("View assessments").click();
    await expect(termMarks.getByText("18/20")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("family-closed-term-marks.png"), fullPage: true });
    expect((await admin.post(`/api/v1/school/terms/${termId}/reopen`, { data: { reason: "Verify release visibility" } })).status()).toBe(200);
    await page.reload();
    await learning.click();
    await expect(termMarks.getByText("No term marks released yet.")).toBeVisible();
    expect((await admin.post(`/api/v1/school/report-cards/${snapshotId}/withdraw`, { data: {} })).status()).toBe(200);
    await page.reload();
    await learning.click();
    await expect(familyReport.getByText("No report cards published yet.")).toBeVisible();

    // The linked student receives the same closed-term result through their
    // self-scoped route, without any child id from the browser.
    expect((await admin.post(`/api/v1/school/terms/${termId}/close`, { data: {} })).status()).toBe(200);
    const studentUsername = `student-report-${suffix}`;
    const studentPassword = "student-report-pass-123";
    const { id: studentUserId } = await post("/api/v1/identity/users", { collegeId, username: studentUsername, displayName: "Asha Browser", temporaryPassword: studentPassword, roles: ["student"] });
    expect((await admin.post(`/api/v1/identity/users/${studentUserId}/password`, { data: { newPassword: studentPassword } })).status()).toBe(200);
    expect((await admin.post(`/api/v1/people/students/${studentId}/identity-link`, { data: { identityUserId: studentUserId } })).status()).toBe(200);
    await page.context().clearCookies();
    await browserLogin(page, { username: studentUsername, password: studentPassword });
    await page.goto("/portal/marks");
    await expect(page.getByRole("heading", { name: "My term marks" })).toBeVisible();
    await expect(page.getByRole("region", { name: "School term marks" }).getByText("90.00%")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "My marks", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "School term marks" })).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("student-closed-term-marks.png"), fullPage: true });

    await teacher.dispose();
  } finally {
    await admin.dispose();
  }
});
