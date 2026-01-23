import { expect, test } from "@playwright/test"
import {
  generateTestDocumentId,
  waitForConnectionState,
} from "./fixtures/test-helpers"

test.describe("Browser Back/Forward Navigation", () => {
  // This test verifies that browser back/forward buttons work correctly
  // with the View Doc routing system.
  //
  // THE BUG: The first user navigation uses replaceState instead of pushState,
  // so the browser back button doesn't work after the first navigation.

  test("should be able to go back after navigating from home to quiz", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    // Start at home page
    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")

    // Verify we're on the home page
    await expect(page.locator(".home-page")).toBeVisible()
    expect(page.url()).toContain("/")

    // Click the Quiz nav button
    await page.click('button:has-text("Quiz")')

    // Wait for navigation to complete
    await page.waitForURL(/\/quiz\//)
    await expect(page.locator(".quiz-page")).toBeVisible()

    // Verify URL changed
    expect(page.url()).toContain("/quiz/")

    // NOW THE CRITICAL TEST: Click browser back button
    await page.goBack()

    // We should be back on the home page
    // THIS IS WHERE THE BUG MANIFESTS: If replaceState was used instead of
    // pushState, goBack() will go to the browser's previous page (outside the app)
    // instead of going back to the home page.
    await expect(page.locator(".home-page")).toBeVisible({ timeout: 5000 })
    expect(page.url()).not.toContain("/quiz/")
  })

  test("should be able to go forward after going back", async ({ page }) => {
    const testDocId = generateTestDocumentId()

    // Start at home page
    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await expect(page.locator(".home-page")).toBeVisible()

    // Navigate to Quiz
    await page.click('button:has-text("Quiz")')
    await page.waitForURL(/\/quiz\//)
    await expect(page.locator(".quiz-page")).toBeVisible()

    // Go back to home
    await page.goBack()
    await expect(page.locator(".home-page")).toBeVisible({ timeout: 5000 })

    // Go forward to quiz
    await page.goForward()
    await expect(page.locator(".quiz-page")).toBeVisible({ timeout: 5000 })
    expect(page.url()).toContain("/quiz/")
  })

  test("should maintain history through multiple navigations", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    // Start at home page
    await page.goto(`/#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await expect(page.locator(".home-page")).toBeVisible()

    // Navigate: Home -> Quiz
    await page.click('button:has-text("Quiz")')
    await page.waitForURL(/\/quiz\//)
    await expect(page.locator(".quiz-page")).toBeVisible()

    // Navigate: Quiz -> Settings
    await page.click('button:has-text("Settings")')
    await page.waitForURL(/\/settings/)
    await expect(page.locator(".settings-page")).toBeVisible()

    // Go back: Settings -> Quiz
    await page.goBack()
    await expect(page.locator(".quiz-page")).toBeVisible({ timeout: 5000 })

    // Go back: Quiz -> Home
    await page.goBack()
    await expect(page.locator(".home-page")).toBeVisible({ timeout: 5000 })

    // Go forward: Home -> Quiz
    await page.goForward()
    await expect(page.locator(".quiz-page")).toBeVisible({ timeout: 5000 })

    // Go forward: Quiz -> Settings
    await page.goForward()
    await expect(page.locator(".settings-page")).toBeVisible({ timeout: 5000 })
  })

  test("should handle direct URL navigation and then back button", async ({
    page,
  }) => {
    const testDocId = generateTestDocumentId()

    // Start directly at quiz page (deep link)
    await page.goto(`/quiz/${testDocId}#${testDocId}`)
    await waitForConnectionState(page, "connected")
    await expect(page.locator(".quiz-page")).toBeVisible()

    // Navigate to Settings
    await page.click('button:has-text("Settings")')
    await page.waitForURL(/\/settings/)
    await expect(page.locator(".settings-page")).toBeVisible()

    // Go back should return to quiz
    await page.goBack()
    await expect(page.locator(".quiz-page")).toBeVisible({ timeout: 5000 })
  })
})
