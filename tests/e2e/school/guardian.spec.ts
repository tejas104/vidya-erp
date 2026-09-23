/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, browserLogin } from "../support/fixtures";

/**
 * Guardian access (ADR-0027), end to end in a real browser against the
 * isolated school stack: the administrator invites a parent from the pupil's
 * record, the parent sets up their own sign-in with the code on the public
 * activation page, signs in, lands in the family portal showing their child
 * — and is refused by the staff API that every staff member can call.
 */
test("administrator invites a parent, who activates, signs in and sees only their child", async ({ page, browser, baseURL }, testInfo) => {
  const adminCreds = {
    username: process.env.SCHOOL_E2E_USERNAME ?? "int-admin",
    password: process.env.SCHOOL_E2E_PASSWORD ?? "integration-admin-pass-1",
  };
  const admin = await apiSession(baseURL!, adminCreds);
  const suffix = Date.now().toString(36);
  const post = async (path: string, data: unknown) => {
    const response = await admin.post(path, { data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as { id: string };
  };

  const { colleges } = (await (await admin.get("/api/v1/people/colleges")).json()) as { colleges: { id: string }[] };
  const collegeId = colleges[0]!.id;
  const { departments } = (await (await admin.get(`/api/v1/people/colleges/${collegeId}/tree`)).json()) as { departments: { id: string }[] };
  const { id: classId } = await post("/api/v1/people/classes", { departmentId: departments[0]!.id, name: `Standard family ${suffix}`, code: `FB-${suffix}` });
  const { id: sectionId } = await post("/api/v1/people/sections", { classId, name: "A" });
  const { id: studentId } = await post("/api/v1/people/students", { collegeId, admissionNo: `FB-${suffix}`, fullName: "Asha Family" });
  await post(`/api/v1/people/students/${studentId}/enrollment`, { sectionId, academicYear: "2026-27" });

  // 1. The administrator invites the parent from the pupil's record.
  await browserLogin(page, adminCreds);
  await page.goto(`/students/${studentId}`);
  const guardians = page.getByRole("region", { name: "Guardians" });
  await expect(guardians.getByText("No guardians linked.")).toBeVisible();
  await guardians.getByLabel("Guardian's name").fill("Meera Family");
  await guardians.getByLabel("Phone number on file").fill("+91-9800000001");
  await guardians.getByRole("button", { name: "Issue invitation code" }).click();
  const shown = guardians.getByRole("status");
  await expect(shown).toContainText("It is shown only now");
  const code = (await shown.locator("p.num").innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  await expect(guardians.getByText("Invitation sent")).toBeVisible();
  await guardians.screenshot({ path: testInfo.outputPath("staff-guardians-panel.png") });

  // 2. The parent, in a fresh browser with no session, sets up their account.
  const parentContext = await browser.newContext({ baseURL });
  const parent = await parentContext.newPage();
  const username = `parent-${suffix}`;
  const password = "family-chosen-passphrase";
  await parent.goto("/activate");
  await parent.getByLabel("Invitation code").fill(code.toLowerCase().replace(/-/g, " "));
  await parent.getByLabel("Your full name").fill("Meera Family");
  await parent.getByLabel("Choose a username").fill(username);
  await parent.getByLabel("Choose a password").fill(password);
  await parent.getByLabel("Type it again").fill(password);
  await parent.getByRole("button", { name: "Create account" }).click();
  await expect(parent.getByRole("heading", { name: "You're set up" })).toBeVisible();
  await expect(parent.getByText("You're linked to Asha Family.")).toBeVisible();

  // 3. The parent signs in and lands in the family portal, not the staff app.
  await browserLogin(parent, { username, password });
  await parent.waitForURL("**/family");
  await expect(parent.getByRole("heading", { name: "Asha Family" })).toBeVisible();
  await expect(parent.getByText("Attendance this year")).toBeVisible();
  await expect(parent.getByText("Not recorded").first()).toBeVisible();
  await expect(parent.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await parent.screenshot({ path: testInfo.outputPath("family-portal.png"), fullPage: true });

  // 4. The server, not the screen, is what keeps the parent out of staff data.
  const staffRead = await parent.evaluate(async () => (await fetch("/api/v1/people/colleges")).status);
  expect(staffRead).toBe(403);
  const pupilRead = await parent.evaluate(async (id) => (await fetch(`/api/v1/people/students/${id}`)).status, studentId);
  expect(pupilRead).toBe(403);

  // 5. The spent code cannot be used again.
  const reuse = await parent.evaluate(async (value) => {
    const response = await fetch("/api/v1/people/guardian-invitations/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: value, fullName: "Someone Else", username: "someone-else-x", password: "another-long-password" }),
    });
    return response.status;
  }, code);
  expect(reuse).toBe(400);

  // 6. And the administrator now sees the parent as an active guardian.
  await page.reload();
  await expect(guardians.getByText("Meera Family")).toBeVisible();
  await expect(guardians.getByText("Active")).toBeVisible();

  await parentContext.close();
  await admin.dispose();
});
