/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

test("a full school roster keeps its header and keyboard scroll region usable", async ({ page, baseURL }, testInfo) => {
  const credentials = {
    username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
    password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
  };
  const admin = await apiSession(baseURL!, credentials);
  const suffix = Date.now().toString(36);
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id: string };
  };
  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
    const { id: classId } = await post("/api/v1/people/classes", { departmentId: departments[0]!.id, name: `Roster ${suffix}`, code: `WR-${suffix}` });
    const { id: sectionId } = await post("/api/v1/people/sections", { classId, name: "A" });
    for (let index = 0; index < 20; index += 1) {
      const { id } = await post("/api/v1/people/students", {
        collegeId, admissionNo: `WR-${suffix}-${index}`, fullName: `Roster student ${String(index).padStart(2, "0")}`,
      });
      await post(`/api/v1/people/students/${id}/enrollment`, { sectionId, academicYear: "2026-27" });
    }

    await browserLogin(page, credentials);
    await page.goto("/manage/students");
    await page.getByLabel("Section").selectOption(sectionId);
    const roster = page.getByRole("region", { name: "Student roster" });
    await expect(roster.getByRole("row")).toHaveCount(21);
    expect(await roster.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await roster.focus();
    await expect(roster).toBeFocused();
    await roster.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => roster.evaluate((element) => {
      const heading = element.querySelector("th")!;
      return Math.abs(heading.getBoundingClientRect().top - element.getBoundingClientRect().top);
    })).toBeLessThanOrEqual(3);
    await expect(roster.getByText("Roster student 19")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".shell-side")).not.toBeInViewport();
    expect(await roster.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await roster.getByRole("row").nth(1).evaluate((row) => row.getBoundingClientRect().height)).toBeLessThanOrEqual(64);
    await expect(page.getByText("Scroll sideways to see all columns.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("workbench-roster-mobile.png"), fullPage: true });
  } finally {
    await admin.dispose();
  }
});
