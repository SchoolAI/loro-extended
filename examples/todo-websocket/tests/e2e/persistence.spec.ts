import { expect, test } from "@playwright/test"
import {
  createTodo,
  generateTestDocumentId,
  waitForRepoState,
} from "./fixtures/test-helpers"

test.describe("Storage Persistence", () => {
  // Note: These tests assume the dev server is already running via playwright.config.ts

  // TODO(duane): Remove skip once IndexedDB is revisited / updated
  test.skip("should persist client state in IndexedDB", async ({ page }) => {
    const testDocId = generateTestDocumentId()
    await page.goto(`/#${testDocId}`)
    await waitForRepoState(page, "ready")

    // Create a todo
    await createTodo(page, "Client Persistence Test")

    // Reload page (without server restart)
    await page.reload()
    await waitForRepoState(page, "ready")

    // Verify todos still present (loaded from IndexedDB)
    await expect(
      page.locator('.todo-item:has-text("Client Persistence Test")'),
    ).toBeVisible()
  })

  test("should sync persisted data between clients", async ({ browser }) => {
    // Use the same document ID for both clients to test sync
    const testDocId = generateTestDocumentId()

    // First client creates a todo
    const page1 = await browser.newPage()
    await page1.goto(`/#${testDocId}`)
    await waitForRepoState(page1, "ready")

    // Create a unique todo
    const todoText = `Persist Test ${Date.now()}`
    await createTodo(page1, todoText)

    // Wait a bit for server to persist
    await page1.waitForTimeout(1000)

    // Second client should see the todo (loaded from server)
    const page2 = await browser.newPage()
    await page2.goto(`/#${testDocId}`)
    await waitForRepoState(page2, "ready")

    // Should see the todo created by first client
    await expect(
      page2.locator(`.todo-item:has-text("${todoText}")`),
    ).toBeVisible({ timeout: 10000 })

    // Clean up
    await page1.close()
    await page2.close()
  })
})