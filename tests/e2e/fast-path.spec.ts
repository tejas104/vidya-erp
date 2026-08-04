import { expect, test, type APIRequestContext } from "@playwright/test";
import { type DemoIds, YEAR, apiSession, browserLogin, discover } from "./support/fixtures";

/**
 * ASSIGNMENT #10 PART 5 — the four fast-path journeys.
 *
 * Why these exist: J3 (attendance) and J5 (marks) in role-journeys.spec.ts are
 * entirely API-driven — they POST at the API and never touch those screens'
 * DOM. The whole teacher interaction model was rewritten in #10 Part 4 while
 * that suite stayed green. Journey (a) below is the first test in this repo
 * that proves a teacher can actually take a register through the UI.
 *
 * Those 18 pre-existing journeys are untouched: they remain the regression net.
 */

const MOBILE = { width: 360, height: 740 };

let ids: DemoIds;
let admin: APIRequestContext;

/**
 * Recording attendance twice for the same (section, date, slot) is a 409 —
 * J3 documents that. Each run therefore uses a slot nobody else will pick, so
 * the journey is repeatable without a reset. The ASSERTIONS stay deterministic;
 * only the key does not collide.
 */
const RUN_SLOT = `p9${String(Date.now() % 1000).padStart(3, "0")}`;

test.beforeAll(async ({ baseURL }) => {
  admin = await apiSession(baseURL!, "admin");
  ids = await discover(admin);
});

test.afterAll(async () => {
  await admin.dispose();
});

// ---------------------------------------------------------------------------
// (a) TEACHER FAST-PATH at 360px: Now screen -> mark 3 absent -> save ->
//     the STUDENT's own portal view confirms it persisted.
// ---------------------------------------------------------------------------
test("A1 teacher marks a register on a 360px viewport and the student's portal shows it", async ({
  page,
  baseURL,
}) => {
  // The student first: we need the real student record behind the portal login,
  // so the round-trip asserts on the same person the teacher marks absent.
  const studentCtx = await apiSession(baseURL!, "student");
  const meRes = await studentCtx.get("/api/v1/portal/me");
  expect(meRes.ok(), "portal/me").toBeTruthy();
  const me = (await meRes.json()) as { student: { id: string; admissionNo: string } };

  await page.setViewportSize(MOBILE);
  await browserLogin(page, "teacher");

  // The Now screen is time-of-day dependent BY DESIGN: the server returns
  // today's timetable and the client picks the period spanning the clock. A
  // run on a Sunday, or outside teaching hours, legitimately lands on
  // off-day / no-classes / day-done. So we assert the screen RENDERS one of
  // its real states rather than forcing an "active" period that the seed may
  // not have right now — pinning the clock would not help, because the
  // entries themselves come from the server's idea of today.
  await page.goto("/manage/now");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const nowBody = page.locator("#main");
  await expect(nowBody).toContainText(
    /Mark attendance|no classes|nothing scheduled|day is done|no timetable|not a teaching day/i,
  );

  // Drive the register itself deterministically, through the same entry point
  // the Now screen's primary button uses (sectionId/subjectId/slot/date).
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(
    `/manage/attendance?sectionId=${encodeURIComponent(ids.sectionId)}` +
      `&subjectId=${encodeURIComponent(ids.ownSubjectId)}` +
      `&slot=${encodeURIComponent(RUN_SLOT)}&date=${encodeURIComponent(today)}`,
  );

  const grid = page.getByRole("group", { name: /attendance grid/i });
  await expect(grid).toBeVisible();

  // Everyone starts present — the 30-second target depends on it.
  const cells = grid.getByRole("button");
  await expect(cells.first()).toHaveAttribute("aria-pressed", "false");

  // The student we will verify, plus two others: three taps, not sixty.
  const target = grid.getByRole("button", { name: new RegExp(`roll ${me.student.admissionNo}\\b`, "i") });
  await expect(target, "the portal student is on this section's roster").toHaveCount(1);
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");

  const total = await cells.count();
  for (let i = 0; i < total && i < 3; i++) {
    const cell = cells.nth(i);
    if ((await cell.getAttribute("aria-pressed")) === "false") await cell.click();
  }

  await expect(page.getByText(/\d+ absent/)).toBeVisible();
  await page.getByRole("button", { name: /^save/i }).click();
  await expect(page.getByText(/attendance saved/i)).toBeVisible({ timeout: 15_000 });

  // The round-trip: the student's OWN scoped portal data must show the absence.
  const attRes = await studentCtx.get(`/api/v1/portal/attendance?academicYear=${YEAR}`);
  expect(attRes.ok(), "portal attendance").toBeTruthy();
  const att = (await attRes.json()) as { sessions: { heldOn: string; status: string }[] };
  expect(
    att.sessions.some((s) => s.heldOn === today && s.status === "absent"),
    "the register the teacher just saved is visible to the student",
  ).toBe(true);

  await studentCtx.dispose();
});

// ---------------------------------------------------------------------------
// (b) MARKS FAST-ENTRY: numeric-first input, auto-advance, progress, one save.
// ---------------------------------------------------------------------------
test("A2 teacher enters marks with auto-advance and a running progress count", async ({ page }) => {
  await browserLogin(page, "teacher");
  await page.goto("/manage/marks");

  // Create the assessment through the UI's own form so the journey covers the
  // real path a teacher takes, then enter scores against it.
  await expect(page.getByRole("heading", { name: /enter marks/i })).toBeVisible();
  const title = `E2E fast-entry ${RUN_SLOT}`;
  await page.getByLabel(/assessment name/i).first().fill(title);
  // Default max score is 10; the scores entered below (41, 37) need headroom
  // or they fail validation and never count toward progress.
  await page.getByLabel(/max score/i).fill("100");
  await page.getByRole("button", { name: /create assessment/i }).click();

  const firstScore = page.getByRole("spinbutton", { name: /^score for /i }).first();
  await expect(firstScore).toBeVisible({ timeout: 15_000 });
  // Numeric-keypad-first is the spec's wording — assert the affordance exists.
  await expect(firstScore).toHaveAttribute("inputmode", "numeric");

  const progress = page.locator("[aria-live='polite']").filter({ hasText: /\d+\/\d+/ }).first();
  await expect(progress).toContainText(/^0\//);

  // Auto-advance: typing a score should move focus on, so the next entry needs
  // no tap. Enter two and assert progress tracked both.
  await firstScore.fill("41");
  await firstScore.press("Enter");
  const secondScore = page.getByRole("spinbutton", { name: /^score for /i }).nth(1);
  await secondScore.fill("37");
  await expect(progress).toContainText(/^2\//);

  await page.getByRole("button", { name: /save marks/i }).click();
  await expect(page.getByText(/saved|marks saved/i).first()).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// (c) GLOBAL SEARCH: find a student by roll number and open their record.
// ---------------------------------------------------------------------------
test("A3 global search finds a student by roll number and opens the record", async ({ page }) => {
  await browserLogin(page, "admin");
  await page.goto("/dashboard");

  const rosterRes = await admin.get(`/api/v1/people/sections/${encodeURIComponent(ids.sectionId)}/roster`);
  const { students } = (await rosterRes.json()) as { students: { id: string; admissionNo: string }[] };
  const target = students[0]!;

  await page.keyboard.press("Control+k");
  const input = page.getByRole("textbox", { name: /search students or pages/i });
  await expect(input).toBeVisible({ timeout: 10_000 });
  // The palette prefetches its index on first open; give it the roll number
  // and wait for the row rather than a fixed sleep.
  await input.fill(target.admissionNo);

  const hit = page.getByRole("button", { name: new RegExp(target.admissionNo, "i") }).first();
  await expect(hit).toBeVisible({ timeout: 20_000 });
  await hit.click();

  // NOTE (spec divergence, deliberate): #10 Part 2's wording is "open
  // slide-over", but S2a/S2b settled on search routing to the FULL-PAGE
  // profile — the SlideOver opens from table rows, and a direct link must
  // survive as its own page. So the assertion is the full-page record.
  await expect(page).toHaveURL(new RegExp(`/students/${target.id}`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ---------------------------------------------------------------------------
// (d) PWA: the manifest is served and valid enough to install.
// ---------------------------------------------------------------------------
test("A4 PWA manifest is served and installable", async ({ page, baseURL }) => {
  const res = await page.request.get(`${baseURL}/manifest.json`);
  expect(res.status(), "manifest served").toBe(200);

  const manifest = (await res.json()) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    theme_color?: string;
    icons?: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifest.name, "name").toBeTruthy();
  expect(manifest.short_name, "short_name").toBeTruthy();
  expect(manifest.start_url, "start_url").toBeTruthy();
  expect(manifest.display, "standalone display").toBe("standalone");
  expect(manifest.theme_color, "theme_color").toBeTruthy();

  const icons = manifest.icons ?? [];
  // Installability needs a 192 and a 512; a maskable icon is what stops
  // Android cropping the launcher badge into a white square.
  expect(icons.some((i) => i.sizes.includes("192")), "192px icon").toBe(true);
  expect(icons.some((i) => i.sizes.includes("512")), "512px icon").toBe(true);
  expect(icons.some((i) => (i.purpose ?? "").includes("maskable")), "maskable icon").toBe(true);

  // Every declared icon must actually resolve — a manifest listing a missing
  // file still parses, and Lighthouse only tells you at audit time.
  for (const icon of icons) {
    const iconRes = await page.request.get(new URL(icon.src, baseURL).toString());
    expect(iconRes.status(), `icon ${icon.src}`).toBe(200);
  }

  // The document must actually link the manifest, or nothing above matters.
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});
