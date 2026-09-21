/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { browserLogin } from "../support/fixtures";

// Use the isolated school database prepared by school-academics-flow.int.test.ts.
const credentials = {
  username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
  password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
};

test("school admin configures weights, closes a term, and reopens it with a recorded reason", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await browserLogin(page, credentials);
  await page.goto("/manage/terms");
  await expect(page.getByRole("heading", { name: "Academic terms" })).toBeVisible();
  await expect(page.locator(".shell-nav-link", { hasText: "Academic terms" })).toBeVisible();
  await page.getByRole("button", { name: "Help" }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help.getByRole("heading", { name: "Academic terms and assessment types", level: 1 })).toBeVisible();
  await expect(help).not.toContainText("Entering marks");
  await help.getByRole("button", { name: "Close" }).click();
  await expect(help).not.toBeVisible();
  await page.getByRole("button", { name: "Help" }).click();
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await page.getByRole("button", { name: "Create term", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const name = `Browser term ${Date.now()}`;
  await dialog.getByLabel("Term name").fill(name);
  await dialog.getByLabel("Start date").fill("2026-04-01");
  await dialog.getByLabel("End date").fill("2027-03-31");
  await dialog.getByRole("button", { name: "Create term", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Assessment types" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add assessment type" }).click();
  await dialog.getByLabel("Type 1 name").fill("Unit tests");
  await dialog.getByLabel("Type 1 weight (%)").fill("40");
  await expect(dialog.getByRole("button", { name: "Save assessment types" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Add assessment type" }).click();
  await dialog.getByLabel("Type 2 name").fill("Annual exam");
  await dialog.getByLabel("Type 2 weight (%)").fill("60");
  await dialog.getByRole("button", { name: "Save assessment types" }).click();
  await expect(dialog).not.toBeVisible();
  await row.getByRole("button", { name: "Close term", exact: true }).click();
  await page.getByRole("button", { name: "Confirm closure" }).click();
  await expect(row.getByText("Closed", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Assessment types" }).click();
  await expect(page.getByLabel("Type 1 name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save assessment types" })).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await row.getByRole("button", { name: "Reopen term" }).click();
  await expect(page.getByRole("button", { name: "Confirm reopening" })).toBeDisabled();
  await page.getByLabel("Reopening reason").fill("Board approved revised assessment plan");
  await page.getByRole("button", { name: "Confirm reopening" }).click();
  await expect(row.getByText("Open", { exact: true })).toBeVisible();
  await page.goto("/manage/system");
  await page.getByLabel("Action", { exact: true }).fill("school-academics.reopened");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByRole("cell", { name: "school-academics.reopened", exact: true }).first()).toBeVisible();
  await page.getByText("View details", { exact: true }).first().click();
  await expect(page.getByRole("row").filter({ hasText: "school-academics.reopened" }).first().getByText(/Board approved revised assessment plan/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("school management screens fit mobile in both themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await browserLogin(page, credentials);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const path of ["/manage/terms", "/manage/system"]) {
      await page.goto(path);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.endsWith("terms")) {
        await expect(page.getByRole("button", { name: "Create term", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Help" }).click();
        const help = page.getByRole("dialog", { name: "Help" });
        await expect(help.getByRole("heading", { name: "Academic terms and assessment types", level: 1 })).toBeVisible();
        await expect(help).not.toContainText("Entering marks");
        await page.keyboard.press("Escape");
        await expect(help).not.toBeVisible();
      }
      else await expect(page.getByLabel("Action", { exact: true })).toBeVisible();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${path.split("/").pop()}.png`), fullPage: true });
    }
  }
});
