import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for database consistency
  workers: 1, // Single worker to avoid port conflicts
  reporter: "list",

  use: {
    baseURL: "http://localhost:8000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Add these for proper session isolation:
    storageState: { cookies: [], origins: [] }, // Start with empty storage state
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "pnpm dev:client",
      port: 8000,
      timeout: 120 * 1000,
      reuseExistingServer: true, // Add this to prevent server restarts
    },
    {
      command: "pnpm dev:server",
      port: 8001,
      timeout: 120 * 1000,
      reuseExistingServer: true, // Add this to prevent server restarts
    },
  ],
})
