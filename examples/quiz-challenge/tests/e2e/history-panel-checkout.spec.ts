import { expect, test } from "@playwright/test"
import {
  generateTestDocumentId,
  selectOption,
  startQuiz,
  waitForConnectionState,
  waitForQuizState,
} from "./fixtures/test-helpers"

test.describe("History Panel Checkout", () => {
  // Test 1: Simple checkout test - doesn't require AI feedback
  test("should restore app to historical state when clicking Restore", async ({
    page,
  }) => {
    // Capture console logs
    page.on("console", msg => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
    })

    const testDocId = generateTestDocumentId()

    // Navigate to the quiz
    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await waitForQuizState(page, "idle")

    // Start the quiz
    await startQuiz(page)
    await waitForQuizState(page, "answering")

    // Select an option (but don't submit - this avoids needing AI feedback)
    await selectOption(page, 0)

    // Wait a moment for the selection to be committed
    await page.waitForTimeout(500)

    // Now we have some history. Open the history panel.
    await page.click('button:has-text("📜 History")')

    // Wait for history panel to be visible
    await page.waitForSelector(".history-panel", { timeout: 5000 })

    // There should be history entries
    const historyEntries = page.locator(".history-entry")
    const entryCount = await historyEntries.count()
    expect(entryCount).toBeGreaterThan(0)

    // Find the "Started Quiz" entry (should be the first one)
    const startedQuizEntry = page.locator(
      '.history-entry:has-text("Started Quiz")',
    )
    await expect(startedQuizEntry).toBeVisible()

    // Click the Restore button on the "Started Quiz" entry
    await startedQuizEntry.locator(".history-restore-btn").click()

    // The app should now show the "detached" banner
    await page.waitForSelector(".detached-banner", { timeout: 5000 })
    await expect(page.locator(".detached-banner")).toBeVisible()

    // CRITICAL: The quiz state should still be "answering" but WITHOUT the selected option
    // This is the bug we're testing - the UI should update to show the historical state
    await waitForQuizState(page, "answering")

    // The selected option should NOT be visible (we're viewing state before selection)
    await expect(page.locator(".option-selected")).not.toBeVisible()

    // Click "Return to Live" to go back to the current state
    await page.click('button:has-text("Return to Live")')

    // The detached banner should disappear
    await expect(page.locator(".detached-banner")).not.toBeVisible()

    // Should still be in answering state with the option selected
    await waitForQuizState(page, "answering")
    await expect(page.locator(".option-selected")).toBeVisible()
  })

  // Test 2: Verify checkout shows different states
  test("should show different UI when checking out different history entries", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await waitForQuizState(page, "idle")

    // Start quiz
    await startQuiz(page)
    await waitForQuizState(page, "answering")

    // Select option B (index 1)
    await selectOption(page, 1)
    await page.waitForTimeout(500)

    // Open history panel
    await page.click('button:has-text("📜 History")')
    await page.waitForSelector(".history-panel", { timeout: 5000 })

    // Find the "Selected Option" entry
    const selectedOptionEntry = page.locator(
      '.history-entry:has-text("Selected Option")',
    )
    await expect(selectedOptionEntry).toBeVisible()

    // Find the "Started Quiz" entry
    const startedQuizEntry = page.locator(
      '.history-entry:has-text("Started Quiz")',
    )
    await expect(startedQuizEntry).toBeVisible()

    // Click restore on "Started Quiz" entry
    await startedQuizEntry.locator(".history-restore-btn").click()

    // Should show detached banner
    await page.waitForSelector(".detached-banner", { timeout: 5000 })

    // Should be in answering state WITHOUT selected option
    await waitForQuizState(page, "answering")
    await expect(page.locator(".option-selected")).not.toBeVisible()

    // Now click restore on "Selected Option" entry
    await selectedOptionEntry.locator(".history-restore-btn").click()

    // Should still show detached banner
    await expect(page.locator(".detached-banner")).toBeVisible()

    // Should be in answering state WITH selected option
    await waitForQuizState(page, "answering")
    await expect(page.locator(".option-selected")).toBeVisible()
  })

  // Test 3: Verify Return to Live works
  test("should return to live state when clicking Return to Live", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await waitForQuizState(page, "idle")

    // Start quiz and select option
    await startQuiz(page)
    await waitForQuizState(page, "answering")
    await selectOption(page, 0)
    await page.waitForTimeout(500)

    // Open history panel and restore to earlier state
    await page.click('button:has-text("📜 History")')
    await page.waitForSelector(".history-panel", { timeout: 5000 })

    const startedQuizEntry = page.locator(
      '.history-entry:has-text("Started Quiz")',
    )
    await startedQuizEntry.locator(".history-restore-btn").click()

    // Verify we're in detached mode
    await page.waitForSelector(".detached-banner", { timeout: 5000 })
    await expect(page.locator(".option-selected")).not.toBeVisible()

    // Click Return to Live
    await page.click('button:has-text("Return to Live")')

    // Detached banner should disappear
    await expect(page.locator(".detached-banner")).not.toBeVisible()

    // Should be back to current state with option selected
    await expect(page.locator(".option-selected")).toBeVisible()
  })

  // Test 4: Verify history panel selection is cleared when returning to live
  test("should clear history panel selection when returning to live", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await waitForQuizState(page, "idle")

    // Start quiz and select option
    await startQuiz(page)
    await waitForQuizState(page, "answering")
    await selectOption(page, 0)
    await page.waitForTimeout(500)

    // Open history panel
    await page.click('button:has-text("📜 History")')
    await page.waitForSelector(".history-panel", { timeout: 5000 })

    // Click restore on "Started Quiz" entry
    const startedQuizEntry = page.locator(
      '.history-entry:has-text("Started Quiz")',
    )
    await startedQuizEntry.locator(".history-restore-btn").click()

    // Verify the entry is selected (has the selected class)
    await expect(startedQuizEntry).toHaveClass(/history-entry-selected/)

    // Click Return to Live
    await page.click('button:has-text("Return to Live")')

    // Wait for detached banner to disappear
    await expect(page.locator(".detached-banner")).not.toBeVisible()

    // The history entry should no longer be selected
    await expect(startedQuizEntry).not.toHaveClass(/history-entry-selected/)
  })
})
