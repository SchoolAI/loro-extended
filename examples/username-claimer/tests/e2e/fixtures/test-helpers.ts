import type { Page } from "@playwright/test"

/**
 * Wait for the WebSocket connection to be established.
 * The app should show sync status after connecting.
 */
export async function waitForRepoConnected(page: Page): Promise<void> {
  // Wait for the app to render and establish WebSocket connection
  // The app calls handle.waitForSync() before making RPC calls
  // We wait for the form to be interactive as a proxy for connection
  await page.waitForSelector(
    'input[placeholder="Enter a username to claim..."]',
    {
      state: "visible",
      timeout: 10000,
    },
  )
  // The button is disabled until username is entered, so just wait for it to exist
  await page.waitForSelector('button[type="submit"]', {
    state: "visible",
    timeout: 10000,
  })
}

/**
 * Fill in a username and submit the form (claim it).
 */
export async function claimUsername(
  page: Page,
  username: string,
): Promise<void> {
  const input = page.locator(
    'input[placeholder="Enter a username to claim..."]',
  )
  await input.fill(username)

  const submitButton = page.locator('button[type="submit"]')
  await submitButton.click()
}

/**
 * Wait for a result to appear (either claimed or taken).
 * Returns the result element for further assertions.
 */
export async function waitForResult(
  page: Page,
  timeout = 15000,
): Promise<{ claimed: boolean; text: string }> {
  // Wait for either the "claimed" or "taken" result to appear
  const resultSelector = ".result.claimed, .result.taken"

  await page.waitForSelector(resultSelector, {
    state: "visible",
    timeout,
  })

  const result = page.locator(resultSelector)
  const isClaimed = await result.evaluate(el =>
    el.classList.contains("claimed"),
  )
  const text = (await result.textContent()) || ""

  return { claimed: isClaimed, text }
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
 * Check if the "Claiming..." state is shown (button disabled, loading).
 */
export async function isClaiming(page: Page): Promise<boolean> {
  const button = page.locator('button[type="submit"]')
  const buttonText = await button.textContent()
  return buttonText === "Claiming..."
}
