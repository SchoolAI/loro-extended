import type { Page } from "@playwright/test"

export async function clearClientStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    return indexedDB.deleteDatabase("loro-repo")
  })
}

export async function waitForTodosReady(page: Page): Promise<void> {
  // Wait for the app to be ready by checking for the form
  await page.waitForSelector('input[placeholder="What needs to be done?"]')
}

export async function createTodo(page: Page, text: string): Promise<void> {
  await page.fill('input[placeholder="What needs to be done?"]', text)
  await page.click('button:has-text("Add")')
  await page.waitForSelector(`li:has-text("${text}")`)
}

export async function getTodoCount(page: Page): Promise<number> {
  return page.locator("ul li").count()
}

export async function deleteTodo(page: Page, text: string): Promise<void> {
  const todoItem = page.locator(`li:has-text("${text}")`)
  await todoItem.locator("button").click()
}
