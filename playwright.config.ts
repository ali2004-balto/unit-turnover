import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser against a real server with its own fresh
 * demo database, so they never touch your local data.
 *
 *   npm run test:e2e
 *
 * The first time on a new computer, install the browser once:
 *   npx playwright install chromium
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run db:reset && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PGLITE_DATA_DIR: ".data/e2e",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
