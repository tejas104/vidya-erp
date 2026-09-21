/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

test("subject teacher creates a school assessment, saves grades and observes closure", async ({ page, baseURL }, testInfo) => {
  const admin = await apiSession(baseURL!, { username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin", password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1" });
  const suffix = Date.now().toString(36);
  const academicYear = "2026-27";
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return await response.json() as { id: string };
  };
  try {
    const { colleges } = await (await admin.get("/api/v1/people/colleges")).json() as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json() as { departments: { id: string }[] };
    const departmentId = departments[0]!.id;
    const { id: classId } = await post("/api/v1/people/classes", { departmentId, name: `Standard browser ${suffix}`, code: `SB-${suffix}` });
    const { id: sectionId } = await post("/api/v1/people/sections", { classId, name: "A" });
    const { id: subjectId } = await post("/api/v1/people/subjects", { departmentId, name: `Math ${suffix}`, code: `MB-${suffix}` });
    const { id: studentId } = await post("/api/v1/people/students", { collegeId, admissionNo: `SB-${suffix}`, fullName: "Meera Browser" });
    await post(`/api/v1/people/students/${studentId}/enrollment`, { sectionId, academicYear });
    const { id: termId } = await post("/api/v1/school/terms", { collegeId, name: `Browser marks ${suffix}`, academicYear, startsOn: "2026-04-01", endsOn: "2027-03-31" });
    expect((await admin.put(`/api/v1/school/terms/${termId}/assessment-types`, { data: { types: [{ name: "Exam", weight: 100 }] } })).ok()).toBe(true);
    const { id: scaleId } = await post("/api/v1/results/scales", { collegeId, name: `Browser scale ${suffix}`, bands: [{ minPct: 80, grade: "A", points: 10 }, { minPct: 0, grade: "B", points: 5 }] });
    const username = `school-browser-${suffix}`, password = "school-browser-pass-123";
    const { id: userId } = await post("/api/v1/identity/users", { collegeId, username, displayName: "School teacher", temporaryPassword: password, roles: [] });
    const { token } = await (await admin.post(`/api/v1/identity/users/${userId}/password-reset`)).json() as { token: string };
    await post("/api/v1/identity/auth/password-reset/confirm", { token, newPassword: password });
    const { id: teacherId } = await post("/api/v1/people/teachers", { collegeId, fullName: "School teacher", staffNo: `TB-${suffix}` });
    expect((await admin.post(`/api/v1/people/teachers/${teacherId}/identity-link`, { data: { identityUserId: userId } })).ok()).toBe(true);
    await post(`/api/v1/people/teachers/${teacherId}/assignments`, { classId, subjectId, academicYear, kind: "subject_teacher" });
    await browserLogin(page, { username, password });
    await page.goto("/manage/marks");
    await page.getByRole("button", { name: "Help" }).click();
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help.getByRole("heading", { name: "School assessments and marks", level: 1 })).toBeVisible();
    await expect(help).not.toContainText("Entering marks");
    await help.getByRole("button", { name: "Close" }).click();
    await expect(help).not.toBeVisible();
    await page.getByRole("button", { name: "Help" }).click();
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();
    await page.getByLabel("Term").selectOption(termId);
    await page.getByLabel("Assessment name").fill("First test");
    await page.getByLabel("Assessment date").fill("2026-06-01");
    await page.getByLabel("Grade scale").selectOption(scaleId);
    await page.getByRole("button", { name: "Create assessment", exact: true }).click();
    await page.getByLabel("score for Meera Browser").fill("16");
    await page.getByRole("button", { name: "Save marks", exact: true }).click();
    await expect(page.getByRole("cell", { name: "16/20", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "A", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".shell-side")).not.toBeInViewport();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.getByRole("button", { name: "Help" }).click();
      await expect(help.getByRole("heading", { name: "School assessments and marks", level: 1 })).toBeVisible();
      await expect(help).not.toContainText("Entering marks");
      await page.keyboard.press("Escape");
      await expect(help).not.toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-marks.png`), fullPage: true });
    }
    await post(`/api/v1/school/terms/${termId}/close`, {});
    await page.reload();
    await page.getByLabel("Term").selectOption(termId);
    await page.getByRole("button", { name: "Open marks" }).click();
    await expect(page.getByText("Term closed · marks are read only.")).toBeVisible();
    await expect(page.getByLabel("score for Meera Browser")).toHaveCount(0);
  } finally { await admin.dispose(); }
});
