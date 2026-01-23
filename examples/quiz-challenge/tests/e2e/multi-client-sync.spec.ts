import { expect, test } from "@playwright/test"
import {
  generateTestDocumentId,
  getCurrentQuestionNumber,
  getFinalScore,
  getSelectedOptionIndex,
  nextQuestion,
  selectOption,
  startQuiz,
  submitAnswer,
  waitForConnectionState,
  waitForQuizState,
  waitForResultsPage,
} from "./fixtures/test-helpers"

test.describe("Multi-Client Synchronization", () => {
  test("should sync quiz start between clients", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    // Use the same document ID for both clients
    const testDocId = generateTestDocumentId()

    // Both clients connect to the same document
    // Navigate to quiz page with the test doc ID in the hash
    await Promise.all([
      client1.goto(`/quiz/${testDocId}#${testDocId}`),
      client2.goto(`/quiz/${testDocId}#${testDocId}`),
    ])

    // Wait for both clients to connect
    await Promise.all([
      waitForConnectionState(client1, "connected"),
      waitForConnectionState(client2, "connected"),
    ])

    // Both should start in idle state (quiz card visible)
    await Promise.all([
      waitForQuizState(client1, "idle"),
      waitForQuizState(client2, "idle"),
    ])

    // Client 1 starts the quiz
    await startQuiz(client1)

    // Client 2 should see the quiz in answering state
    await waitForQuizState(client2, "answering")

    // Both should be on question 1
    const q1Client1 = await getCurrentQuestionNumber(client1)
    const q1Client2 = await getCurrentQuestionNumber(client2)
    expect(q1Client1).toBe(1)
    expect(q1Client2).toBe(1)

    await client1.close()
    await client2.close()
  })

  test("should sync option selection between clients", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    const testDocId = generateTestDocumentId()

    await Promise.all([
      client1.goto(`/quiz/${testDocId}#${testDocId}`),
      client2.goto(`/quiz/${testDocId}#${testDocId}`),
    ])

    await Promise.all([
      waitForConnectionState(client1, "connected"),
      waitForConnectionState(client2, "connected"),
    ])

    // Start quiz from client 1
    await startQuiz(client1)
    await waitForQuizState(client2, "answering")

    // Client 1 selects option 2 (index 1)
    await selectOption(client1, 1)

    // Wait for sync and verify client 2 sees the selection
    await client2.waitForSelector(".option-selected", { timeout: 10000 })
    const selectedIndex = await getSelectedOptionIndex(client2)
    expect(selectedIndex).toBe(1)

    await client1.close()
    await client2.close()
  })

  test("should sync answer submission and AI feedback", async ({ browser }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    const testDocId = generateTestDocumentId()

    await Promise.all([
      client1.goto(`/quiz/${testDocId}#${testDocId}`),
      client2.goto(`/quiz/${testDocId}#${testDocId}`),
    ])

    await Promise.all([
      waitForConnectionState(client1, "connected"),
      waitForConnectionState(client2, "connected"),
    ])

    // Start quiz and select an option
    await startQuiz(client1)
    await waitForQuizState(client2, "answering")
    await selectOption(client1, 0)

    // Submit answer from client 1
    await submitAnswer(client1)

    // Both clients should see submitted state
    await Promise.all([
      waitForQuizState(client1, "submitted"),
      waitForQuizState(client2, "submitted"),
    ])

    // Wait for AI feedback (server reactor writes to sensors)
    // Both clients should transition to reviewing state
    await Promise.all([
      waitForQuizState(client1, "reviewing"),
      waitForQuizState(client2, "reviewing"),
    ])

    // Both should see the feedback
    await expect(client1.locator(".feedback")).toBeVisible()
    await expect(client2.locator(".feedback")).toBeVisible()

    await client1.close()
    await client2.close()
  })

  test("should allow Client 2 to advance quiz (bidirectional)", async ({
    browser,
  }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    const testDocId = generateTestDocumentId()

    await Promise.all([
      client1.goto(`/quiz/${testDocId}#${testDocId}`),
      client2.goto(`/quiz/${testDocId}#${testDocId}`),
    ])

    await Promise.all([
      waitForConnectionState(client1, "connected"),
      waitForConnectionState(client2, "connected"),
    ])

    // Client 1 starts quiz, selects, and submits
    await startQuiz(client1)
    await waitForQuizState(client2, "answering")
    await selectOption(client1, 0)
    await submitAnswer(client1)

    // Wait for reviewing state
    await Promise.all([
      waitForQuizState(client1, "reviewing"),
      waitForQuizState(client2, "reviewing"),
    ])

    // CLIENT 2 clicks next question (bidirectional control)
    await nextQuestion(client2)

    // Both should advance to question 2
    await Promise.all([
      waitForQuizState(client1, "answering"),
      waitForQuizState(client2, "answering"),
    ])

    const q2Client1 = await getCurrentQuestionNumber(client1)
    const q2Client2 = await getCurrentQuestionNumber(client2)
    expect(q2Client1).toBe(2)
    expect(q2Client2).toBe(2)

    await client1.close()
    await client2.close()
  })

  test("should sync through all 3 questions to completion", async ({
    browser,
  }) => {
    const client1 = await browser.newPage()
    const client2 = await browser.newPage()

    const testDocId = generateTestDocumentId()

    await Promise.all([
      client1.goto(`/quiz/${testDocId}#${testDocId}`),
      client2.goto(`/quiz/${testDocId}#${testDocId}`),
    ])

    await Promise.all([
      waitForConnectionState(client1, "connected"),
      waitForConnectionState(client2, "connected"),
    ])

    // Start quiz
    await startQuiz(client1)
    await waitForQuizState(client2, "answering")

    // Go through all 3 questions, alternating which client advances
    for (let q = 1; q <= 3; q++) {
      // Select correct answer (index 0 for Q1, index 1 for Q2 and Q3)
      const correctIndex = q === 1 ? 0 : 1
      await selectOption(client1, correctIndex)
      await submitAnswer(client1)

      // Wait for reviewing
      await Promise.all([
        waitForQuizState(client1, "reviewing"),
        waitForQuizState(client2, "reviewing"),
      ])

      // Alternate which client advances
      const advancingClient = q % 2 === 1 ? client1 : client2
      await nextQuestion(advancingClient)

      if (q < 3) {
        // Should be on next question
        await Promise.all([
          waitForQuizState(client1, "answering"),
          waitForQuizState(client2, "answering"),
        ])
      }
    }

    // With the new routing, quiz completion navigates to the results page
    // Wait for both clients to see the results page
    await Promise.all([
      waitForResultsPage(client1),
      waitForResultsPage(client2),
    ])

    // Both should show the same score
    const score1 = await getFinalScore(client1)
    const score2 = await getFinalScore(client2)
    expect(score1.score).toBe(score2.score)
    expect(score1.total).toBe(3)
    expect(score2.total).toBe(3)
    // Verify correct score value (all 3 answers are correct in this test)
    // This catches the 2X score bug where N clients cause N× increment
    expect(score1.score).toBe(3)

    await client1.close()
    await client2.close()
  })
})
