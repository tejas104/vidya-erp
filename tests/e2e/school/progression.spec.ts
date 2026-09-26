/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

/**
 * N6 in a real browser: an administrator closes a section's year (promote,
 * detain, transfer out), previews, applies, and the leaving pupil's family
 * then sees only the ADR-0027 Decision 9 read-only window.
 */
const credentials = {
  username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
  password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
};
const DAY = 86_400_000;

test("administrator promotes, detains and transfers out a section; the leaving family keeps read-only records", async ({ page, browser, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = await apiSession(baseURL!, credentials);
  const suffix = Date.now().toString(36);
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const year = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  const nextYear = `${startYear + 1}-${String((startYear + 2) % 100).padStart(2, "0")}`;
  // Closed yesterday, so live family access has already ended and the read-only window is running.
  const endsOn = new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id: string };
  };
  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
    const standard5 = await post("/api/v1/people/classes", { departmentId: departments[0]!.id, name: `Standard 5 ${suffix}`, code: `P5-${suffix}` });
    const standard6 = await post("/api/v1/people/classes", { departmentId: departments[0]!.id, name: `Standard 6 ${suffix}`, code: `P6-${suffix}` });
    const fiveA = await post("/api/v1/people/sections", { classId: standard5.id, name: "A" });
    const fiveB = await post("/api/v1/people/sections", { classId: standard5.id, name: "B" });
    const sixA = await post("/api/v1/people/sections", { classId: standard6.id, name: "A" });
    const pupils: Record<string, string> = {};
    for (const name of ["Asha Progress", "Dev Progress", "Ira Progress"]) {
      const pupil = await post("/api/v1/people/students", { collegeId, admissionNo: `P-${name.split(" ")[0]}-${suffix}`, fullName: name });
      const enrolled = await admin.post(`/api/v1/people/students/${pupil.id}/enrollment`, { data: { sectionId: fiveA.id, academicYear: year, startsOn: "2026-06-01" } });
      expect(enrolled.status(), await enrolled.text()).toBe(200);
      pupils[name] = pupil.id;
    }
    // Ira's parent is linked before the year closes.
    const invited = (await (await admin.post(`/api/v1/people/students/${pupils["Ira Progress"]}/guardian-invitations`, {
      data: { guardianName: "Meera Progress", relationshipType: "parent", contactMethod: "email", contactValue: `meera-${suffix}@example.test` },
    })).json()) as { code: string };
    const parentName = `progress-parent-${suffix}`;
    const parentPassword = "progress-parent-passphrase";
    const activated = await admin.post("/api/v1/people/guardian-invitations/activate", { data: { code: invited.code, fullName: "Meera Progress", username: parentName, password: parentPassword } });
    expect(activated.status(), await activated.text()).toBe(201);

    await browserLogin(page, credentials);
    await page.goto("/manage/progression");
    await expect(page.getByRole("heading", { name: "Promotion and exits" })).toBeVisible();
    await page.getByRole("combobox", { name: "Section" }).selectOption(fiveA.id);
    await expect(page.getByRole("combobox", { name: "Outcome for Asha Progress" })).toHaveValue("promote");
    await page.getByLabel(`Last day of ${year}`).fill(endsOn);
    await page.getByRole("combobox", { name: "Outcome for Dev Progress" }).selectOption("detain");
    await page.getByRole("textbox", { name: "Reason for Dev Progress" }).fill("Did not meet the promotion criteria");
    await page.getByRole("combobox", { name: "Outcome for Ira Progress" }).selectOption("transfer_out");
    await page.getByRole("textbox", { name: "Reason for Ira Progress" }).fill("Family relocated to Chennai");
    await page.getByLabel("Next academic year").fill(nextYear);
    await page.getByLabel("New year starts").fill(`${startYear + 1}-06-01`);
    await page.getByRole("combobox", { name: "Promote into" }).selectOption(sixA.id);
    await page.getByRole("combobox", { name: "Detained pupils repeat in" }).selectOption(fiveB.id);
    await page.getByRole("button", { name: "Preview changes" }).click();

    await expect(page.getByText("3. Check and apply")).toBeVisible();
    const leaver = page.getByRole("row").filter({ hasText: "Ira Progress" }).last();
    await expect(leaver).toContainText("Transfer out");
    await expect(leaver).toContainText("Active → Transferred");
    await expect(leaver).toContainText("Leaves the school");
    await expect(page.getByRole("row").filter({ hasText: "Asha Progress" }).last()).toContainText(`Standard 6 ${suffix} · A from ${startYear + 1}-06-01`);
    await expect(page.getByText(/can read attendance and published report cards as they stood on that day/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("progression-preview.png"), fullPage: true });

    await page.getByRole("button", { name: "Apply to 3 pupils" }).click();
    await page.getByRole("dialog", { name: "Apply these changes?" }).getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByText(/Recorded for 3 pupils/)).toBeVisible();
    await expect(page.getByText(`No pupils on this section's ${year} roll.`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("progression-applied.png"), fullPage: true });

    // The record keeps the outcome.
    await page.goto(`/students/${pupils["Ira Progress"]}`);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("Year-end outcome: Transferred out — Family relocated to Chennai")).toBeVisible();

    // The family sees the read-only window, not the live school.
    const parentContext = await browser.newContext({ baseURL });
    const parent = await parentContext.newPage();
    await browserLogin(parent, { username: parentName, password: parentPassword });
    await parent.waitForURL("**/family");
    await expect(parent.getByText(/Ira Progress has left the school\. Through .* you can read their attendance and published report cards/)).toBeVisible();
    await expect(parent.getByRole("button", { name: "Fees" })).toHaveCount(0);
    await expect(parent.getByRole("button", { name: "Notices" })).toHaveCount(0);
    await parent.screenshot({ path: testInfo.outputPath("family-after-exit.png"), fullPage: true });
    await parentContext.close();
    expect(errors).toEqual([]);
  } finally {
    await admin.dispose();
  }
});
