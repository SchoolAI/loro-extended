import { expect, test } from "@playwright/test"
import {
  checkUsername,
  waitForRepoConnected,
  waitForResult,
} from "./fixtures/test-helpers"

test.describe("Username Checker RPC Sync", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForRepoConnected(page)
  })

  test("should receive response when checking 'admin' username", async ({
    page,
  }) => {
    // This test reproduces the sync issue where:
    // 1. Client sends RPC request via Askforce
    // 2. Server receives and processes the request
    // 3. Server writes answer to CRDT document
    // 4. Client should receive the sync update with the answer
    //
    // If this test fails with a timeout error, it confirms the sync issue is reproducible.
    // The error message will show: "Timeout waiting for answer (askId=..., peerId=..., mode="rpc", timeoutMs=10000)"

    // Fill in "admin" and submit
    await checkUsername(page, "admin")

    // Wait for either a successful result OR an error
    // The sync issue manifests as a timeout error from Askforce
    const resultSelector = ".result.available, .result.taken, .result.error"
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

    // "admin" is in the takenUsernames set, so it should be taken
    expect(result.available).toBe(false)
    expect(result.text).toContain("admin")
    expect(result.text).toContain("taken")
  })

  test("should receive response when checking available username", async ({
    page,
  }) => {
    // Test with a username that should be available
    const uniqueUsername = `testuser_${Date.now()}`

    await checkUsername(page, uniqueUsername)

    // Wait for either a successful result OR an error
    const resultSelector = ".result.available, .result.taken, .result.error"
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

    expect(result.available).toBe(true)
    expect(result.text).toContain(uniqueUsername)
    expect(result.text).toContain("available")
  })

  test("should receive response when checking invalid username", async ({
    page,
  }) => {
    // Test with an invalid username (too short)
    await checkUsername(page, "ab")

    // Wait for either a successful result OR an error
    const resultSelector = ".result.available, .result.taken, .result.error"
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

    expect(result.available).toBe(false)
    expect(result.text).toContain("invalid")
  })

  test("should show suggestions for taken username", async ({ page }) => {
    await checkUsername(page, "admin")

    // Wait for either a successful result OR an error
    const resultSelector = ".result.available, .result.taken, .result.error"
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

    expect(result.available).toBe(false)

    // Check that suggestions are shown
    const suggestions = page.locator(".suggestion")
    await expect(suggestions).toHaveCount(3, { timeout: 5000 })
  })
})
