import { expect, test } from "@playwright/test"
import { createTodo, waitForTodosReady } from "./fixtures/test-helpers"

test.describe("Storage Persistence", () => {
  // Note: These tests assume the dev server is already running via playwright.config.ts

  test("should sync persisted data between clients", async ({ browser }) => {
    // Create both pages upfront
    const [page1, page2] = await Promise.all([
      browser.newPage(),
      browser.newPage(),
    ])

    // First client connects and creates a todo
    await page1.goto("/")
    await waitForTodosReady(page1)

    const todoText = `Persist Test ${Date.now()}`
    await createTodo(page1, todoText)

    // Second client connects - should see the todo via sync
    await page2.goto("/")
    await waitForTodosReady(page2)

    // Should see the todo created by first client
    await expect(page2.locator(`li:has-text("${todoText}")`)).toBeVisible()

    // Clean up
    await Promise.all([page1.close(), page2.close()])
  })
})
