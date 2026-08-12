import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "./support/fixtures";

/**
 * ASSIGNMENT #11 TASK 12 — first-run onboarding checklist, guard (d).
 *
 * Covers what's specific to this feature: the admin checklist renders on
 * /dashboard and every item is a real, working deep link — not just an href
 * string. Persistence itself (Task 11's preference store) is unit-tested in
 * OnboardingChecklist.test.tsx; this journey only proves the wiring is real
 * end to end, through the actual browser login and the actual pages.
 *
 * IDEMPOTENCE: this journey ends by dismissing the checklist, which writes
 * `dismissed: true` to demo-admin's stored preference — and a dismissed
 * checklist never renders again. Without the reset below the test passes
 * exactly once per fresh database and fails on every run after that, which
 * is how it originally shipped. The reset goes through the real preference
 * API rather than straight to SQL, so the journey stays black-box.
 */
test("A1 admin onboarding checklist renders on the dashboard and its items deep-link", async ({
  page,
  baseURL,
}) => {
  const api = await apiSession(baseURL!, "admin");
  const reset = await api.put("/api/v1/system/preferences/onboarding:admin", {
    data: { value: { dismissed: false, checked: {} } },
  });
  expect(reset.status(), "reset the checklist to its first-run state").toBe(200);

  await browserLogin(page, "admin");
  await page.goto("/dashboard");

  const card = page.locator("section[aria-label='Onboarding checklist']");
  await expect(card.getByText("Get started")).toBeVisible();

  const items: [string, string][] = [
    ["Change your password", "/manage/users"],
    ["Set up your academic structure", "/manage/org"],
    ["Import your students", "/manage/import/students"],
    ["Import your staff", "/manage/import/staff"],
    ["Set your fee structure", "/manage/fees"],
    ["Print sign-in credentials", "/manage/classes"],
  ];
  for (const [label, href] of items) {
    await expect(card.getByRole("link", { name: label })).toHaveAttribute("href", href);
  }

  // Prove one of them is a real, working deep link — not a dead href.
  await card.getByRole("link", { name: "Import your students" }).click();
  await expect(page).toHaveURL(/\/manage\/import\/students$/);
  await expect(page.getByRole("heading", { name: /import students/i })).toBeVisible();

  // Dismissal is reachable by keyboard and persists (Task 11's preference store).
  await page.goto("/dashboard");
  await expect(card.getByText("Get started")).toBeVisible();
  await card.getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText("Get started")).not.toBeVisible();

  await page.reload();
  await expect(card.getByText("Get started")).not.toBeVisible();
});
