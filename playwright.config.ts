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

/**
 * Edition suites (#13). An install's edition is fixed when the SERVER boots
 * (config.edition gates which modules the composition root registers), so the
 * two suites cannot share one webServer — they are two runs, not two projects
 * against one target:
 *
 *   pnpm test:e2e                        # college (the regression net)
 *   VIDYA_EDITION=school pnpm test:e2e   # school
 *
 * Specs directly under tests/e2e/ are SHARED and run in both: login, scope
 * probes and anything whose behaviour is edition-independent. Only
 * genuinely edition-specific journeys go in the college/ or school/
 * subdirectory, so the college regression net stays byte-identical.
 *
 * Only the project matching the booted server is active — a school spec run
 * against a college server would fail on missing modules rather than on a
 * real regression, which is exactly the false signal to avoid.
 */
const edition = process.env.VIDYA_EDITION === "school" ? "school" : "college";
const otherEdition = edition === "school" ? "college" : "school";

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
  projects: [
    {
      name: edition,
      use: { ...devices["Desktop Chrome"] },
      // Shared specs plus this edition's own; the other edition's are skipped.
      testIgnore: [`${otherEdition}/**`],
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_WEB_COMMAND ?? "pnpm --filter @vidya/web start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
