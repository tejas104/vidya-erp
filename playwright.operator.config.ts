import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/operator",
  timeout: 45_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3130", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "android-width", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: "pnpm --filter @vidya/operator dev", url: "http://127.0.0.1:3130", reuseExistingServer: true, timeout: 90_000 },
});
