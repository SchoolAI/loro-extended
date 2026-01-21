import { change, type TypedDoc } from "@loro-extended/change"
import type { Reactor } from "../shared/reactor-types.js"
import { entered } from "../shared/reactor-types.js"
import type { Question, QuizDocSchema } from "../shared/schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Server Reactors
// ═══════════════════════════════════════════════════════════════════════════
//
// These reactors run on the SERVER (Node.js). They handle:
// - AI feedback generation (writes to sensors namespace)
//
// Key insight: Effects that should happen ONCE (not per-client) run on server.
// The CRDT syncs the results to all clients.

// ═══════════════════════════════════════════════════════════════════════════
// AI Feedback Effect Reactor (Server-side)
// ═══════════════════════════════════════════════════════════════════════════
// When an answer is submitted, calls the AI API and writes the response
// to the sensors namespace.
//
// Pattern: Observes state transition, performs async I/O, writes to sensors.
// This is the "effect reactor" pattern.
//
// This reactor runs on the SERVER, ensuring:
// - Feedback is generated exactly once (not duplicated across tabs)
// - The server is the single source of truth for AI responses
// - All clients receive the same feedback via CRDT sync

export function createAiFeedbackReactor(
  doc: TypedDoc<typeof QuizDocSchema>,
  questions: Question[],
): Reactor {
  return async ({ before, after }) => {
    // Only trigger when entering "submitted" state
    if (!entered("submitted", before, after)) return

    const quiz = after.quiz.state
    if (quiz.status !== "submitted") return

    const question = questions[quiz.questionIndex]
    if (!question) return

    const requestId = quiz.requestId
    const selectedOption = quiz.selectedOption
    const isCorrect = selectedOption === question.correctIndex

    // Simulate AI API call (in real app, this would be an actual API call)
    await new Promise(resolve => setTimeout(resolve, 500))

    // Generate feedback
    const feedback = isCorrect
      ? "Correct! Great job understanding this concept."
      : `Not quite. The correct answer was "${question.options[question.correctIndex]}". ${
          selectedOption === -1
            ? "You ran out of time!"
            : "Keep studying and you'll get it next time!"
        }`

    // Write to sensors namespace (this is the "effect")
    // Also increment score here - server-only ensures it happens exactly once
    // (not duplicated across multiple connected clients)
    change(doc, draft => {
      draft.sensors.feedbackResponses[requestId] = {
        isCorrect,
        feedback,
        receivedAt: Date.now(),
      }
      // Server increments score - runs exactly once per correct answer
      if (isCorrect) {
        draft.score.value = (draft.score.value ?? 0) + 1
      }
    })
  }
}
