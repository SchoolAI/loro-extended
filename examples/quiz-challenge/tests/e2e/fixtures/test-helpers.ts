import type { Page } from "@playwright/test"
import { v4 as uuidv4 } from "uuid"

/**
 * Generate a unique document ID for test isolation.
 */
export function generateTestDocumentId(): string {
  return `test-quiz-${uuidv4()}`
}

/**
 * Wait for the WebSocket connection to reach a specific state.
 */
export async function waitForConnectionState(
  page: Page,
  state: "connected" | "connecting" | "reconnecting" | "disconnected",
): Promise<void> {
  await page.waitForSelector(`.connection-bar.${state}`, { timeout: 30000 })
}

/**
 * Wait for the quiz to be in a specific state.
 * Uses the data-quiz-state attribute on the quiz-card for reliable detection.
 */
export async function waitForQuizState(
  page: Page,
  state: "idle" | "answering" | "submitted" | "reviewing" | "complete",
): Promise<void> {
  await page.waitForSelector(`.quiz-card[data-quiz-state="${state}"]`, {
    timeout: 30000,
  })
}

/**
 * Start the quiz by clicking the start button.
 */
export async function startQuiz(page: Page): Promise<void> {
  await page.click('button:has-text("Start Quiz")')
  await waitForQuizState(page, "answering")
}

/**
 * Select an answer option by index (0-based).
 */
export async function selectOption(page: Page, index: number): Promise<void> {
  await page.click(`.option:nth-child(${index + 1})`)
}

/**
 * Submit the current answer.
 */
export async function submitAnswer(page: Page): Promise<void> {
  await page.click('button:has-text("Submit Answer")')
}

/**
 * Click the next question button.
 */
export async function nextQuestion(page: Page): Promise<void> {
  // Button text changes based on whether it's the last question
  const nextButton = page.locator(
    'button:has-text("Next Question"), button:has-text("See Results")',
  )
  await nextButton.click()
}

/**
 * Get the current question number from the progress text.
 */
export async function getCurrentQuestionNumber(page: Page): Promise<number> {
  const progressText = await page.locator(".progress-text").textContent()
  const match = progressText?.match(/Question (\d+) of/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Get the selected option index (0-based), or null if none selected.
 */
export async function getSelectedOptionIndex(
  page: Page,
): Promise<number | null> {
  const selectedOption = page.locator(".option-selected")
  const count = await selectedOption.count()
  if (count === 0) return null

  // Find the index of the selected option
  const options = page.locator(".option")
  const optionCount = await options.count()
  for (let i = 0; i < optionCount; i++) {
    const option = options.nth(i)
    const hasSelectedClass = await option.evaluate(el =>
      el.classList.contains("option-selected"),
    )
    if (hasSelectedClass) return i
  }
  return null
}

/**
 * Get the final score from the complete screen.
 */
export async function getFinalScore(
  page: Page,
): Promise<{ score: number; total: number }> {
  const scoreNumber = await page.locator(".score-number").textContent()
  const scoreTotal = await page.locator(".score-total").textContent()
  return {
    score: parseInt(scoreNumber || "0", 10),
    total: parseInt(scoreTotal || "0", 10),
  }
}
