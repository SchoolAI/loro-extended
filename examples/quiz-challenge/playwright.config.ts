import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for consistency
  workers: 1, // Single worker to avoid port conflicts
  reporter: "list",

  use: {
    baseURL: "http://localhost:8004",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
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

  webServer: {
    command: "pnpm dev:server",
    port: 8004,
    timeout: 120 * 1000,
    reuseExistingServer: true,
    env: {
      PORT: "8004",
    },
  },
})
