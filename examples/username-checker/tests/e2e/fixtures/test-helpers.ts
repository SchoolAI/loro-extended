import type { Page } from "@playwright/test"

/**
 * Wait for the WebSocket connection to be established.
 * The app should show sync status after connecting.
 */
export async function waitForRepoConnected(page: Page): Promise<void> {
  // Wait for the app to render and establish WebSocket connection
  // The app calls handle.waitForSync() before making RPC calls
  // We wait for the form to be interactive as a proxy for connection
  await page.waitForSelector('input[placeholder="Enter a username..."]', {
    state: "visible",
    timeout: 10000,
  })
  // The button is disabled until username is entered, so just wait for it to exist
  await page.waitForSelector('button[type="submit"]', {
    state: "visible",
    timeout: 10000,
  })
}

/**
 * Fill in a username and submit the form.
 */
export async function checkUsername(
  page: Page,
  username: string,
): Promise<void> {
  const input = page.locator('input[placeholder="Enter a username..."]')
  await input.fill(username)

  const submitButton = page.locator('button[type="submit"]')
  await submitButton.click()
}

/**
 * Wait for a result to appear (either available or taken).
 * Returns the result element for further assertions.
 */
export async function waitForResult(
  page: Page,
  timeout = 15000,
): Promise<{ available: boolean; text: string }> {
  // Wait for either the "available" or "taken" result to appear
  const resultSelector = ".result.available, .result.taken"

  await page.waitForSelector(resultSelector, {
    state: "visible",
    timeout,
  })

  const result = page.locator(resultSelector)
  const isAvailable = await result.evaluate(el =>
    el.classList.contains("available"),
  )
  const text = (await result.textContent()) || ""

  return { available: isAvailable, text }
}

/**
 * Wait for an error result to appear.
 */
export async function waitForError(
  page: Page,
  timeout = 15000,
): Promise<string> {
  await page.waitForSelector(".result.error", {
    state: "visible",
    timeout,
  })

  const errorText = await page.locator(".result.error").textContent()
  return errorText || ""
}

/**
 * Check if the "Checking..." state is shown (button disabled, loading).
 */
export async function isChecking(page: Page): Promise<boolean> {
  const button = page.locator('button[type="submit"]')
  const buttonText = await button.textContent()
  return buttonText === "Checking..."
}
