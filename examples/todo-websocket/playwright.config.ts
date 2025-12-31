import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for database consistency
  workers: 1, // Single worker to avoid port conflicts
  reporter: "list",

  // Clean database before running tests
  globalSetup: "./tests/e2e/fixtures/global-setup.ts",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm dev",
    port: 5173,
    timeout: 120 * 1000,
    reuseExistingServer: false, // Start fresh server with clean database
  },
})
