import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PORT) || 5173

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for database consistency
  workers: 1, // Single worker to avoid port conflicts
  reporter: "list",

  // Clean database before running tests
  globalSetup: "./tests/e2e/fixtures/global-setup.ts",

  use: {
    baseURL: `http://localhost:${port}`,
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
    command: `PORT=${port} pnpm dev`,
    port,
    timeout: 120 * 1000,
    reuseExistingServer: false, // Start fresh server with clean database
  },
})
