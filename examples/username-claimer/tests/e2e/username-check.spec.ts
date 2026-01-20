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

    // Fill in "admin" and submit
    await claimUsername(page, "admin")

    // Wait for either a successful result OR an error
    const resultSelector = ".result.claimed, .result.taken, .result.error"
    await page.waitForSelector(resultSelector, {
      state: "visible",
      timeout: 15000,
    })

    // Check what we got
    const errorResult = page.locator(".result.error")
    const hasError = (await errorResult.count()) > 0

    if (hasError) {
      const errorText = await errorResult.textContent()
      expect(hasError, `Sync issue reproduced! Error: ${errorText}`).toBe(false)
    }

    // If we get here, sync worked - verify the result
    const result = await waitForResult(page, 1000)

    // "admin" is in the reservedUsernames set, so it should be taken
    expect(result.claimed).toBe(false)
    expect(result.text).toContain("admin")
    expect(result.text).toContain("taken")
  })

  test("should successfully claim available username", async ({ page }) => {
    // Test with a username that should be available
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
})

test.describe("Username Claimer UX", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForRepoConnected(page)
  })

  test("should show feedback zone and claimed section on initial load", async ({
    page,
  }) => {
    // Feedback zone should be visible
    const feedbackZone = page.locator(".feedback-zone")
    await expect(feedbackZone).toBeVisible()

    // Claimed section should be visible with header
    const claimedSection = page.locator(".claimed-section")
    await expect(claimedSection).toBeVisible()
    await expect(claimedSection).toContainText("Recently Claimed")
  })

  test("should have 'How it works' section collapsed by default", async ({
    page,
  }) => {
    // The details element should exist but not be open
    const details = page.locator("details.how-it-works")
    await expect(details).toBeVisible()

    // The comparison content should not be visible (collapsed)
    const comparison = page.locator(".comparison")
    await expect(comparison).not.toBeVisible()

    // Click to expand
    const summary = page.locator("details.how-it-works summary")
    await summary.click()

    // Now comparison should be visible
    await expect(comparison).toBeVisible()
  })
})
