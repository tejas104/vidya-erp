import { expect, test } from "@playwright/test";
import { browserLogin } from "./support/fixtures";

/**
 * ASSIGNMENT #11 TASK 10 — guard (c): the in-app help SlideOver.
 *
 * Proves the whole pipeline end to end through the real browser — the "?"
 * button on a wired screen opens the panel, and the panel renders the actual
 * compiled doc (scripts/compile-help.ts output), not merely an empty dialog.
 * Uses the attendance screen: content/help/college/attendance.md is the
 * doc this suite's baseline ships with, so its exact heading and step text
 * are asserted here rather than a generic "something rendered" check.
 */
test("A1 help panel opens on the attendance screen and shows the real doc content", async ({ page }) => {
  await browserLogin(page, "teacher");
  await page.goto("/manage/attendance");

  await page.getByRole("button", { name: "Help" }).click();

  const panel = page.getByRole("dialog", { name: "Help" });
  await expect(panel).toBeVisible();

  // The doc's own H1 — proves the compiled title made it into the panel,
  // not just a static shell.
  await expect(panel.getByRole("heading", { name: "Marking attendance", level: 1 })).toBeVisible();
  // Body text and a numbered step, both unique to attendance.md's content —
  // an empty-state panel ("No help yet for this screen.") could never match these.
  await expect(panel).toContainText("Attendance is marked per class session");
  await expect(panel).toContainText("Open Attendance from the sidebar.");
  await expect(panel).toContainText("Students below 75% attendance are flagged automatically");

  // Closing it restores the underlying screen — not just a visual overlay.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Record attendance" })).toBeVisible();
});
