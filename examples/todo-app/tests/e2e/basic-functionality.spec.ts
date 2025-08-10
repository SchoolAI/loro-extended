import { expect, test } from "@playwright/test"
import {
  clearClientStorage,
  createTodo,
  waitForRepoState,
} from "./fixtures/test-helpers"

test.describe("Basic Todo Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForRepoState(page, "ready")
    // Clear any existing todos
    await clearClientStorage(page)
    await page.reload()
    await waitForRepoState(page, "ready")
  })

  test("should create and display a todo", async ({ page }) => {
    await createTodo(page, "Test Todo")

    const todoItems = await page.locator(".todo-item")
    await expect(todoItems).toHaveCount(1)
    await expect(page.locator(".todo-item span").first()).toHaveText(
      "Test Todo",
    )
  })

  test("should toggle todo completion", async ({ page }) => {
    await createTodo(page, "Toggle Test")

    // Use more specific selector for the todo we just created
    const todoItem = page.locator('.todo-item:has-text("Toggle Test")')
    const checkbox = todoItem.locator('input[type="checkbox"]')

    await expect(checkbox).not.toBeChecked()

    await checkbox.check()
    await expect(checkbox).toBeChecked()
    await expect(todoItem).toHaveClass(/completed/)
  })

  test("should delete a todo", async ({ page }) => {
    await createTodo(page, "Delete Test")

    // Use more specific selector for the todo we want to delete
    const todoItem = page.locator('.todo-item:has-text("Delete Test")')
    await todoItem.locator(".delete-button").click()

    // Wait for the item to be removed
    await expect(todoItem).toHaveCount(0)
  })
})
