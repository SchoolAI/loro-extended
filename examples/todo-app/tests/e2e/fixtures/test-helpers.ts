import type { Page } from "@playwright/test"
import { v4 as uuidv4 } from "uuid"

export function generateTestDocumentId(): string {
  return `test-${uuidv4()}`
}

export async function clearClientStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    return indexedDB.deleteDatabase("loro-repo")
  })
}

export async function waitForRepoState(
  page: Page,
  state: string,
): Promise<void> {
  await page.waitForSelector(`.status-${state}`)
}

export async function createTodo(page: Page, text: string): Promise<void> {
  await page.fill('input[placeholder="What needs to be done?"]', text)
  await page.click('button:has-text("Add")')
  await page.waitForSelector(`.todo-item:has-text("${text}")`)
}
