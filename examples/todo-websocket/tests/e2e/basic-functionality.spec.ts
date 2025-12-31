import { expect, test } from "@playwright/test"
import { createTodo, waitForTodosReady } from "./fixtures/test-helpers"

test.describe("Basic Todo Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForTodosReady(page)
  })

  test("should create and display a todo", async ({ page }) => {
    await createTodo(page, "Test Todo")

    // Verify the todo we created exists (not necessarily first due to persistence)
    const todoItem = page.locator('li:has-text("Test Todo")')
    await expect(todoItem).toBeVisible()
  })

  test("should toggle todo completion", async ({ page }) => {
    await createTodo(page, "Toggle Test")

    // Use more specific selector for the todo we just created
    const todoItem = page.locator('li:has-text("Toggle Test")')
    const checkbox = todoItem.locator('input[type="checkbox"]')

    await expect(checkbox).not.toBeChecked()

    await checkbox.check()
    await expect(checkbox).toBeChecked()
    // The span gets class "done" when checked
    await expect(todoItem.locator("span")).toHaveClass(/done/)
  })

  test("should delete a todo", async ({ page }) => {
    await createTodo(page, "Delete Test")

    // Use more specific selector for the todo we want to delete
    const todoItem = page.locator('li:has-text("Delete Test")')
    await todoItem.locator("button").click()

    // Wait for the item to be removed
    await expect(todoItem).toHaveCount(0)
  })
})
