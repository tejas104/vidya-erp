/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

test("administrator edits a school PDF format and keeps the uploaded sample as a private reference", async ({ page, baseURL }, testInfo) => {
  const credentials = { username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin", password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1" };
  const admin = await apiSession(baseURL!, credentials);
  try {
    const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
    const collegeId = colleges[0]!.id;
    await browserLogin(page, credentials);
    await page.goto("/manage/school-policies");
    await expect(page.getByRole("heading", { name: "Document formats" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "School" })).toHaveValue(collegeId);
    await page.getByRole("combobox", { name: "Document type" }).selectOption("attendance_review");
    await page.getByLabel("School name").fill("Greenfield School");
    await page.getByLabel("Accent colour").fill("#176a57");
    await page.getByLabel("Footer text").fill("School office copy");
    await page.getByLabel("Sample PDF or DOCX (reference only)").setInputFiles({
      name: "school-sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await page.getByRole("button", { name: "Save format" }).click();
    await expect(page.getByText(/Saved version \d+\. New documents use this format/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Download current sample/ })).toBeVisible();
    const sample = await admin.get(`/api/v1/school/document-formats/${collegeId}/attendance_review/sample`);
    expect(sample.status()).toBe(200);
    expect((await sample.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await page.screenshot({ path: testInfo.outputPath("document-formats-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Document formats" })).toBeVisible();
    await expect.poll(() => page.locator(".shell-side").evaluate((sidebar) => sidebar.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("document-formats-phone.png"), fullPage: true });
  } finally { await admin.dispose(); }
});
