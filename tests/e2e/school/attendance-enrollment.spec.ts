/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

const credentials = {
  username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
  password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
};

test("school admin verifies a legacy enrollment date before attendance review counts days", async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = await apiSession(baseURL!, credentials);
  const suffix = Date.now().toString(36);
  const create = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id: string };
  };
  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
    const className = `Attendance ${suffix}`;
    const termName = `Attendance term ${suffix}`;
    const schoolClass = await create("/api/v1/people/classes", { departmentId: departments[0]!.id, name: className, code: `AT-${suffix}` });
    const section = await create("/api/v1/people/sections", { classId: schoolClass.id, name: "A" });
    const pupil = await create("/api/v1/people/students", { collegeId, admissionNo: `AT-${suffix}`, fullName: "Date Review Pupil" });
    const enrolled = await admin.post(`/api/v1/people/students/${pupil.id}/enrollment`, { data: { sectionId: section.id, academicYear: "2026-27" } });
    expect(enrolled.status()).toBe(200);
    const term = await create("/api/v1/school/terms", { collegeId, name: termName, academicYear: "2026-27", startsOn: "2026-09-01", endsOn: "2026-12-31" });
    const calendar = await admin.put(`/api/v1/school/terms/${term.id}/calendar`, { data: { instructionalDays: ["2026-09-21", "2026-09-22", "2026-09-23"], shortfallThreshold: 75, expectedVersion: 0 } });
    expect(calendar.status(), await calendar.text()).toBe(200);

    await browserLogin(page, credentials);
    await page.goto("/manage/attendance-review");
    await page.getByRole("combobox", { name: "Term" }).selectOption({ label: `Attendance term ${suffix} · 2026-27` });
    await page.getByRole("combobox", { name: "Section" }).selectOption(section.id);
    await page.getByLabel("Through date").fill("2026-09-23");
    await page.getByRole("button", { name: "Review attendance" }).click();
    const pupilRow = page.getByRole("row").filter({ hasText: "Date Review Pupil" });
    await expect(pupilRow.getByText("Enrollment start date needs verification")).toBeVisible();
    await expect(pupilRow).toContainText("Date needed");

    await page.goto("/manage/students");
    await page.getByRole("combobox", { name: "Section" }).selectOption(section.id);
    const rosterRow = page.getByRole("row").filter({ hasText: "Date Review Pupil" });
    await rosterRow.getByRole("button", { name: "Set enrollment date" }).click();
    const dialog = page.getByRole("dialog", { name: /Enrollment dates/ });
    await expect(dialog.getByRole("combobox", { name: "Enrollment record" }).locator("option")).toHaveCount(1);
    await dialog.getByLabel("Effective from").fill("2026-09-23");
    await expect(dialog.getByLabel("Effective from")).toHaveValue("2026-09-23");
    await dialog.getByRole("button", { name: "Save verified dates" }).click();
    await expect(dialog).not.toBeVisible();

    await page.goto("/manage/attendance-review");
    await page.getByRole("combobox", { name: "Term" }).selectOption(term.id);
    await page.getByRole("combobox", { name: "Section" }).selectOption(section.id);
    await page.getByLabel("Through date").fill("2026-09-23");
    await page.getByRole("button", { name: "Review attendance" }).click();
    const revised = page.getByRole("row").filter({ hasText: "Date Review Pupil" });
    await expect(revised).toContainText("0 / 1");
    await expect(revised).not.toContainText("Enrollment start date needs verification");
    await expect(page.getByText("Daily registers to complete")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("verified-attendance-review.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await admin.dispose();
  }
});
