// S2a evidence screenshots: regrouped collapsible sidebar + Cmd-K search palette.
// Standalone (not part of the e2e suite) — run against an already-running prod server:
//   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx tsx tests/shots/s2a.shots.ts
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const outDir = "docs/assignment-10";
const CREDS = { username: "demo-admin", password: "demo-admin-pass-2026!" };

async function login(page: Page) {
  await page.goto(`${baseURL}/login`);
  await page.waitForSelector("#username");
  await page.fill("#username", CREDS.username);
  await page.fill("#password", CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
  await page.fill('input[placeholder*="Search"]', "re"); // matches Reports/Results pages
  await page.waitForTimeout(400); // debounce + first paint
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${outDir}/${name}` });
  console.log(`wrote ${outDir}/${name}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Desktop 1280
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await login(desk);
  // collapse one group (People) to show collapsed + expanded side by side
  const peopleBtn = desk.getByRole("button", { name: /People/i }).first();
  if (await peopleBtn.count()) await peopleBtn.click();
  await desk.waitForTimeout(200);
  await shot(desk, "s2a-sidebar-1280.png");
  await openSearch(desk);
  await shot(desk, "s2a-search-1280.png");
  await desk.close();

  // Mobile 360
  const mob = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await login(mob);
  // open the nav drawer on mobile
  const menu = mob.getByRole("button", { name: /open menu/i }).first();
  if (await menu.count()) await menu.click();
  await mob.waitForTimeout(200);
  await shot(mob, "s2a-sidebar-360.png");
  await mob.keyboard.press("Control+k");
  await mob.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 }).catch(() => {});
  await mob.waitForTimeout(300);
  await shot(mob, "s2a-search-360.png");
  await mob.close();

  await browser.close();
  console.log("s2a screenshots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
