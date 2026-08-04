// Assignment #10 evidence screenshots: the Part 3/4 screens (PWA + teacher
// fast-path) at both viewports. Standalone, like s2b.shots.ts — run against an
// already-running prod server:
//   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx tsx tests/shots/a10.shots.ts
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const outDir = "docs/assignment-10";

const TEACHER = { username: "demo-teacher-ds", password: "demo-teacher-pass-2026!" };
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-2026!" };

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 360, height: 740 };

async function login(page: Page, creds: { username: string; password: string }) {
  await page.goto(`${baseURL}/login`);
  await page.waitForSelector("#username");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(350); // chart/skeleton paint
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${outDir}/${name}` });
  console.log(`wrote ${outDir}/${name}`);
}

/** The teacher fast-path screens — the reason Part 4 exists, so both viewports. */
async function teacherAt(browser: Browser, viewport: typeof DESKTOP, suffix: string) {
  const page = await browser.newPage({ viewport });
  await login(page, TEACHER);

  await page.goto(`${baseURL}/manage/now`);
  await settle(page);
  await shot(page, `a10-now-${suffix}.png`);

  // The register itself: default all-present, then a few marked absent so the
  // filled-vs-outline distinction is visible in the evidence (and survives a
  // greyscale print, which is the point of not using colour alone).
  await page.goto(`${baseURL}/manage/attendance`);
  await settle(page);
  await shot(page, `a10-attendance-${suffix}.png`);

  const cells = page.getByRole("group", { name: /attendance grid/i }).getByRole("button");
  const n = await cells.count();
  for (let i = 0; i < Math.min(3, n); i++) await cells.nth(i).click();
  if (n > 0) {
    await page.waitForTimeout(150);
    await shot(page, `a10-attendance-marked-${suffix}.png`);
  } else {
    console.warn(`!! no attendance grid for ${TEACHER.username} — skipping marked shot`);
  }

  await page.goto(`${baseURL}/manage/marks`);
  await settle(page);
  await shot(page, `a10-marks-${suffix}.png`);

  await page.close();
}

/** Analytics is admin/principal/hod only — shoot it as the admin. */
async function analyticsAt(browser: Browser, viewport: typeof DESKTOP, suffix: string) {
  const page = await browser.newPage({ viewport });
  await login(page, ADMIN);
  await page.goto(`${baseURL}/manage/analytics`);
  await settle(page);
  await shot(page, `a10-analytics-${suffix}.png`);
  await page.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    await teacherAt(browser, DESKTOP, "1280");
    await teacherAt(browser, MOBILE, "360");
    await analyticsAt(browser, DESKTOP, "1280");
    await analyticsAt(browser, MOBILE, "360");
  } finally {
    await browser.close();
  }
  console.log("a10 screenshots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
