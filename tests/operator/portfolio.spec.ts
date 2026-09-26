import { expect, test } from "@playwright/test";

test("operator portfolio preview is usable on desktop and phone widths", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One view across every school." })).toBeVisible();
  await expect(page.getByText("Synthetic data · 26 Sep 2026", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Needs attention" }).click();
  await expect(page.getByRole("button", { name: "View Riverbend Academy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Harborview School" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Greenfield School" })).toHaveCount(0);
  await page.getByRole("button", { name: "View Riverbend Academy" }).click();
  await expect(page.getByRole("dialog", { name: "Riverbend Academy details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "View Harborview School" }).click();
  await expect(page.getByRole("dialog", { name: "Harborview School details" })).toContainText("Read only");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search schools" }).fill("nothing matches");
  await expect(page.getByText("No schools match this view. Try another search or filter.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search schools" }).fill("");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("operator-portfolio.png"), fullPage: true });
});
