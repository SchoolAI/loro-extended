import { expect, test } from "@playwright/test"
import {
  claimUsername,
  waitForRepoConnected,
  waitForResult,
} from "./fixtures/test-helpers"

test.describe("Username Claimer RPC Sync", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForRepoConnected(page)
  })

  test("should receive response when claiming reserved 'admin' username", async ({
    page,
  }) => {
    // This test reproduces the sync issue where:
    // 1. Client sends RPC request via Asks
    // 2. Server receives and processes the request
    // 3. Server writes answer to CRDT document
    // 4. Client should receive the sync update with the answer
    //
    // If this test fails with a timeout error, it confirms the sync issue is reproducible.
    // The error message will show: "Timeout waiting for answer (askId=..., peerId=..., mode="rpc", timeoutMs=10000)"

    // Fill in "admin" and submit
    await claimUsername(page, "admin")

    // Wait for either a successful result OR an error
    // The sync issue manifests as a timeout error from Asks
    const resultSelector = ".result.claimed, .result.taken, .result.error"
    await page.waitForSelector(resultSelector, {
      state: "visible",
      timeout: 15000,
    })

    // Check what we got
    const errorResult = page.locator(".result.error")
    const hasError = (await errorResult.count()) > 0

    if (hasError) {
      // SYNC ISSUE REPRODUCED: The server processed the request but the response never arrived
      const errorText = await errorResult.textContent()
      console.log("SYNC ISSUE REPRODUCED:", errorText)

      // Fail the test with a descriptive message
      expect(hasError, `Sync issue reproduced! Error: ${errorText}`).toBe(false)
    }

    // If we get here, sync worked - verify the result
    const result = await waitForResult(page, 1000) // Short timeout since we already waited

    // "admin" is in the reservedUsernames set, so it should be taken
    expect(result.claimed).toBe(false)
    expect(result.text).toContain("admin")
    expect(result.text).toContain("taken")
  })

  test("should successfully claim available username", async ({ page }) => {
    // Test with a username that should be available
    // Use base36 encoding to keep username under 20 chars (e.g., "user_m5x7abc" = 12 chars)
    const uniqueUsername = `user_${Date.now().toString(36)}`

    await claimUsername(page, uniqueUsername)

    // Wait for either a successful result OR an error
    const resultSelector = ".result.claimed, .result.taken, .result.error"
    await page.waitForSelector(resultSelector, {
      state: "visible",
      timeout: 15000,
    })

    const errorResult = page.locator(".result.error")
    const hasError = (await errorResult.count()) > 0

    if (hasError) {
      const errorText = await errorResult.textContent()
      expect(hasError, `Sync issue reproduced! Error: ${errorText}`).toBe(false)
    }

    const result = await waitForResult(page, 1000)

    expect(result.claimed).toBe(true)
    expect(result.text).toContain(uniqueUsername)
    expect(result.text).toContain("yours")
  })

  test("should receive response when claiming invalid username", async ({
    page,
  }) => {
    // Test with an invalid username (too short)
    await claimUsername(page, "ab")

    // Wait for either a successful result OR an error
    const resultSelector = ".result.claimed, .result.taken, .result.error"
    await page.waitForSelector(resultSelector, {
      state: "visible",
      timeout: 15000,
    })

    const errorResult = page.locator(".result.error")
    const hasError = (await errorResult.count()) > 0

    if (hasError) {
      const errorText = await errorResult.textContent()
      expect(hasError, `Sync issue reproduced! Error: ${errorText}`).toBe(false)
    }

    const result = await waitForResult(page, 1000)

    expect(result.claimed).toBe(false)
    expect(result.text).toContain("invalid")
  })

  test("should show suggestions for reserved username", async ({ page }) => {
    await claimUsername(page, "admin")

    // Wait for either a successful result OR an error
    const resultSelector = ".result.claimed, .result.taken, .result.error"
    await page.waitForSelector(resultSelector, {
      state: "visible",
      timeout: 15000,
    })

    const errorResult = page.locator(".result.error")
    const hasError = (await errorResult.count()) > 0

    if (hasError) {
      const errorText = await errorResult.textContent()
      expect(hasError, `Sync issue reproduced! Error: ${errorText}`).toBe(false)
    }

    const result = await waitForResult(page, 1000)

    expect(result.claimed).toBe(false)

    // Check that suggestions are shown
    const suggestions = page.locator(".suggestion")
    await expect(suggestions).toHaveCount(3, { timeout: 5000 })
  })
})
