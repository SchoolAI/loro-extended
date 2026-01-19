import { defineConfig, devices } from "@playwright/test"

// Use a unique port for e2e tests to avoid conflicts with other examples
// Port allocation: todo-sse uses 8000/8001, username-checker uses 8002, todo-websocket uses 8003
const port = 8002

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially for consistency
  workers: 1, // Single worker to avoid port conflicts
  reporter: "list",

  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Start with empty storage state for isolation
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
    command: `PORT=${port} bun run src/server.ts`,
    port,
    timeout: 120 * 1000,
    reuseExistingServer: false,
  },
})
