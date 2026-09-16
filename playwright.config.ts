import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end coverage of the one path that matters: sign up, connect a
 * database, save a dataset, build a dashboard, publish it, and open the public
 * link as an anonymous visitor.
 *
 * Requires the docker-compose databases to be up and `pnpm db:push` to have
 * run. ALLOW_PRIVATE_DB_HOSTS is set for the web server because the demo
 * database is on localhost, which the SSRF guard blocks by default.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // In CI: "list" for the readable transcript, "github" for inline
  // annotations, and "json" so a failure can be summarized in a few lines
  // rather than hunted for in the middle of a long log.
  reporter: process.env.CI
    ? [["list"], ["github"], ["json", { outputFile: "playwright-report/results.json" }]]
    : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start --port 3100",
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          ALLOW_PRIVATE_DB_HOSTS: "true",
          // Keep the public page's cache short so the test can assert on
          // fresh data without waiting a minute.
          PUBLIC_CACHE_TTL_SECONDS: "1",
        },
      },
});
