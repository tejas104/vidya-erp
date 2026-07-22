// Parity screenshots for the ui-system login port (Task 19). Not part of the
// e2e suite — a standalone script run against an already-running prod server.
//
//   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx tsx tests/shots/login.shots.ts
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const outDir = "docs/assignment-10";

const sizes = [
  { name: "login-1280.png", width: 1280, height: 800 },
  { name: "login-360.png", width: 360, height: 740 },
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const { name, width, height } of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${baseURL}/login`);
    await page.waitForSelector("#username");
    await page.screenshot({ path: `${outDir}/${name}` });
    await page.close();
  }
  await browser.close();
  console.log(`wrote screenshots to ${outDir}`);
}

main();
