// S2b evidence screenshots: one migrated screen per domain, the StudentSlideOver
// open, the fee-receipt print path, and a dark-mode shot.
//
// Standalone (not part of the e2e suite) — run against an already-running prod server:
//   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx tsx tests/shots/s2b.shots.ts
//
// The final review (I10) noted the 18-journey e2e suite touches only three DOM
// selectors, so it cannot verify 25 migrated screens. These screenshots are the
// load-bearing visual evidence for S2b — hence one per domain rather than a sample.
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const outDir = "docs/assignment-10";
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-2026!" };
/** /portal is STUDENT_ONLY — shooting it as the admin yields a 403, not the screen. */
const STUDENT = { username: "demo-student", password: "demo-student-pass-2026!" };

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 360, height: 740 };

/** One migrated screen per task-domain (see the S2b batch table), all admin-visible. */
const SCREENS: { name: string; path: string }[] = [
  { name: "students", path: "/manage/students" }, // PEOPLE (B1)
  { name: "attendance", path: "/manage/attendance" }, // TEACH (B2)
  { name: "results", path: "/manage/results" }, // RECORDS (B3)
  { name: "fees", path: "/manage/fees" }, // FEES (B4)
  { name: "notices", path: "/manage/notices" }, // COMMUNICATION (B4)
  { name: "reports", path: "/manage/reports" }, // REPORTS (B4)
  { name: "users", path: "/manage/users" }, // ADMINISTRATION (B5)
];

async function login(page: Page, creds: { username: string; password: string } = ADMIN) {
  await page.goto(`${baseURL}/login`);
  await page.waitForSelector("#username");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
  console.log(`wrote ${outDir}/${name}`);
}

/** Settle async screens: the migrated pages fetch on mount behind AsyncState. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(600);
}

async function screensAt(browser: Browser, viewport: typeof DESKTOP, suffix: string) {
  const page = await browser.newPage({ viewport });
  await login(page);
  for (const { name, path } of SCREENS) {
    await page.goto(`${baseURL}${path}`);
    await settle(page);
    await shot(page, `s2b-${name}-${suffix}.png`);
  }
  await page.close();
}

/** PORTAL (B6) — must authenticate as the student, or the screen 403s. */
async function portalAt(browser: Browser, viewport: typeof DESKTOP, suffix: string) {
  const page = await browser.newPage({ viewport });
  await login(page, STUDENT);
  await page.goto(`${baseURL}/portal`);
  await settle(page);
  if (await page.getByText(/Couldn't load your register/i).count()) {
    console.warn("!! /portal rendered its error state — check the student's seed data");
  }
  await shot(page, `s2b-portal-${suffix}.png`);
  await page.close();
}

/** The StudentSlideOver, opened from the students table's row "View" button. */
async function slideOverAt(browser: Browser, viewport: typeof DESKTOP, suffix: string, dark = false) {
  const page = await browser.newPage({
    viewport,
    colorScheme: dark ? "dark" : "light",
  });
  await login(page);
  await page.goto(`${baseURL}/manage/students`);
  await settle(page);
  const view = page.getByRole("button", { name: "View" }).first();
  if ((await view.count()) === 0) {
    console.warn("!! no View button on /manage/students — roster empty? skipping SlideOver shot");
    await page.close();
    return;
  }
  await view.click();
  await page.getByRole("dialog").waitFor({ timeout: 5000 });
  await page.waitForTimeout(400); // slide-over transition
  await shot(page, `s2b-slideover${dark ? "-dark" : ""}-${suffix}.png`);
  await page.close();
}

/**
 * Fee-receipt print preview (final-review M6). Task C deleted an `@media print`
 * rule for the old `.ui-scrim`; the receipt still prints from inside a ui-system
 * Modal, and nothing else covers that path.
 */
async function receiptPrintAt(browser: Browser, viewport: typeof DESKTOP, suffix: string) {
  const page = await browser.newPage({ viewport });
  await login(page);
  await page.goto(`${baseURL}/manage/fees`);
  await settle(page);
  const receipt = page.locator(".receipt-print").first();
  if ((await receipt.count()) === 0) {
    console.warn("!! no .receipt-print visible on /manage/fees — needs a paid invoice; skipping");
    await page.close();
    return;
  }
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  await shot(page, `s2b-fee-receipt-print-${suffix}.png`);
  await page.emulateMedia({ media: "screen" });
  await page.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    await screensAt(browser, DESKTOP, "1280");
    await screensAt(browser, MOBILE, "360");
    await portalAt(browser, DESKTOP, "1280");
    await portalAt(browser, MOBILE, "360");
    await slideOverAt(browser, DESKTOP, "1280");
    await slideOverAt(browser, MOBILE, "360");
    await slideOverAt(browser, DESKTOP, "1280", true); // dark mode — I6 avatar ink
    await receiptPrintAt(browser, DESKTOP, "1280");
  } finally {
    await browser.close();
  }
  console.log("s2b screenshots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
