/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

test("administrator follows a pupil across independent Student 360 tabs and an enrollment move", async ({ page, baseURL }, testInfo) => {
  const credentials = {
    username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
    password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
  };
  const admin = await apiSession(baseURL!, credentials);
  const suffix = Date.now().toString(36);
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id?: string };
  };
  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
    const { id: classId } = await post("/api/v1/people/classes", { departmentId: departments[0]!.id, name: `Standard record ${suffix}`, code: `S36-${suffix}` });
    const { id: firstSection } = await post("/api/v1/people/sections", { classId, name: "A" });
    const { id: currentSection } = await post("/api/v1/people/sections", { classId, name: "B" });
    const { id: studentId } = await post("/api/v1/people/students", { collegeId, admissionNo: `S36-${suffix}`, fullName: "Meera Browser" });
    await post(`/api/v1/people/students/${studentId}/enrollment`, { sectionId: firstSection, academicYear: "2026-27" });
    await post(`/api/v1/people/students/${studentId}/enrollment`, { sectionId: currentSection, academicYear: "2026-27" });

    await browserLogin(page, credentials);
    await page.goto(`/students/${studentId}`);
    await expect(page.getByRole("heading", { name: "Meera Browser" })).toBeVisible();
    await expect(page.getByText(`Admission S36-${suffix} · Standard record ${suffix} · Section B · 2026-27`)).toBeVisible();
    await page.getByRole("tab", { name: "Academics" }).click();
    await expect(page.getByText("No marks recorded for this year.")).toBeVisible();
    await page.getByRole("tab", { name: "Attendance" }).click();
    await expect(page.getByText("No attendance recorded for this year.")).toBeVisible();
    await page.getByRole("tab", { name: "Finance" }).click();
    await expect(page.getByText("No invoices recorded.")).toBeVisible();
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByText("No documents on file.")).toBeVisible();
    await page.getByRole("tab", { name: "Family" }).click();
    await expect(page.getByText("No guardians linked.")).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "Enrollment history" })).toBeVisible();
    await expect(page.getByText(`Standard record ${suffix} · Section A`)).toBeVisible();
    await expect(page.getByText(`Standard record ${suffix} · Section B`, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("student-360-history.png"), fullPage: true });
    await page.reload();
    await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Meera Browser" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    // Resizing from desktop animates the global navigation rail off screen.
    // Wait for that transition so the captured mobile state is settled.
    await expect.poll(() => page.locator(".shell-side").evaluate((side) => side.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await expect.poll(() => page.locator('[role="tab"][aria-selected="true"]').evaluate((selected) => {
      const selectedRect = selected.getBoundingClientRect();
      const viewport = selected.parentElement!.parentElement!.getBoundingClientRect();
      // Borders and fractional pixels can put the box one pixel past the edge.
      return selectedRect.left >= viewport.left - 2 && selectedRect.right <= viewport.right + 2;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("student-360-mobile.png"), fullPage: true });
  } finally {
    await admin.dispose();
  }
});
