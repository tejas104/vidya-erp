import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite (#8) — the real routing layer, no in-process shortcuts.
 *
 * Runs a real browser and real HTTP against a running web server that is
 * itself wired to the compose stack (Postgres/Redis/MinIO) with the demo
 * seed applied. This is the only test tier that exercises Next.js's
 * file-based router, which is why the 16 orphaned endpoints went undetected
 * everywhere else.
 *
 * Local: point at an already-running server —
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001 pnpm test:e2e
 * CI / self-hosted: leave PLAYWRIGHT_BASE_URL unset and let webServer boot a
 * production server (the CI job migrates + seeds first).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  // Journeys mutate a shared seeded database (create users, submit leave,
  // schedule exams) — order-independent but not safe to interleave.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_COMMAND ?? "pnpm --filter @vidya/web start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
