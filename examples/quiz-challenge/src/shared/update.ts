import { change, type Frontiers, type TypedDoc } from "@loro-extended/change"
import { createUpdate, getTimestampFromFrontier } from "@loro-extended/lea"
import type { QuizMsg } from "./messages.js"
import type { Question, QuizDoc, QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Update Function
// ═══════════════════════════════════════════════════════════════════════════
// The update function is the heart of LEA. It:
// 1. Receives the current frontier and a message
// 2. Derives state from the frontier
// 3. Applies the state machine transition
// 4. Returns the new frontier
//
// Key insight: This is deterministic. Same frontier + same message = same result.
//
// NOTE: The generic createUpdate factory is imported from @loro-extended/lea.
// This file only contains quiz-specific update logic.

// Exported for use in UI and reactors
export const QUESTION_TIME_LIMIT = 30 // seconds

// Re-export from @loro-extended/lea for backwards compatibility
export { createUpdate, getTimestampFromFrontier }

// ═══════════════════════════════════════════════════════════════════════════
// State Derivation (Pure)
// ═══════════════════════════════════════════════════════════════════════════

export function getState(
  doc: TypedDoc<typeof QuizDocSchema>,
  frontier: Frontiers,
): QuizDoc {
  const forkedDoc = doc.forkAt(frontier)
  // IMPORTANT: Call toJSON() to get a plain object, not a proxy.
  // The forkedDoc is a TypedDoc proxy with Symbol properties.
  // React will fail if it tries to enumerate a proxy with Symbols.
  return forkedDoc.toJSON()
}

// ═══════════════════════════════════════════════════════════════════════════
// Quiz Update Function Factory
// ═══════════════════════════════════════════════════════════════════════════
// Creates the update function with questions captured in closure.
// This keeps the update signature clean: (doc, frontier, msg) → frontier

export function createQuizUpdate(questions: Question[]) {
  return createUpdate<typeof QuizDocSchema, QuizMsg>((doc, msg, timestamp) => {
    // Read directly from doc - it's a fork, so this is safe
    const quiz = doc.quiz.state

    switch (msg.type) {
      // ═══════════════════════════════════════════════════════════════════
      // START_QUIZ: idle → answering
      // ═══════════════════════════════════════════════════════════════════
      case "START_QUIZ": {
        if (quiz.status !== "idle") return

        change(doc, draft => {
          draft.quiz.state = {
            status: "answering",
            questionIndex: 0,
            selectedOption: null,
            startedAt: msg.timestamp, // From message - keeps update pure!
          }
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // SELECT_OPTION: Update selected option while answering
      // ═══════════════════════════════════════════════════════════════════
      case "SELECT_OPTION": {
        if (quiz.status !== "answering") return

        change(doc, draft => {
          draft.quiz.state = {
            ...quiz,
            selectedOption: msg.optionIndex,
          }
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // TIME_UP: Auto-submit when time runs out
      // ═══════════════════════════════════════════════════════════════════
      case "TIME_UP": {
        if (quiz.status !== "answering") return

        const requestId = `req_${timestamp}_${quiz.questionIndex}`

        change(doc, draft => {
          draft.quiz.state = {
            status: "submitted",
            questionIndex: quiz.questionIndex,
            selectedOption: quiz.selectedOption ?? -1, // -1 means no answer
            submittedAt: timestamp,
            requestId,
          }
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // SUBMIT_ANSWER: answering → submitted
      // ═══════════════════════════════════════════════════════════════════
      case "SUBMIT_ANSWER": {
        if (quiz.status !== "answering") return
        if (quiz.selectedOption === null) return // Must select an option

        const requestId = `req_${timestamp}_${quiz.questionIndex}`
        const selectedOption = quiz.selectedOption // Captured after null check

        change(doc, draft => {
          draft.quiz.state = {
            status: "submitted",
            questionIndex: quiz.questionIndex,
            selectedOption,
            submittedAt: timestamp,
            requestId,
          }
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // RECEIVE_FEEDBACK: submitted → reviewing
      // ═══════════════════════════════════════════════════════════════════
      case "RECEIVE_FEEDBACK": {
        if (quiz.status !== "submitted") return
        if (quiz.requestId !== msg.requestId) return // Wrong request

        change(doc, draft => {
          draft.quiz.state = {
            status: "reviewing",
            questionIndex: quiz.questionIndex,
            selectedOption: quiz.selectedOption,
            isCorrect: msg.isCorrect,
            feedback: msg.feedback,
          }
          // Score is incremented by server in aiFeedbackReactor
          // (not here, to avoid N× increment with N clients)
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // NEXT_QUESTION: reviewing → answering | complete
      // ═══════════════════════════════════════════════════════════════════
      case "NEXT_QUESTION": {
        if (quiz.status !== "reviewing") return

        const nextIndex = quiz.questionIndex + 1
        const isLastQuestion = nextIndex >= questions.length
        const currentScore = doc.score.value ?? 0 // Get the plain number value

        change(doc, draft => {
          if (isLastQuestion) {
            draft.quiz.state = {
              status: "complete",
              score: currentScore,
              totalQuestions: questions.length,
              completedAt: timestamp,
            }
          } else {
            draft.quiz.state = {
              status: "answering",
              questionIndex: nextIndex,
              selectedOption: null,
              startedAt: msg.timestamp, // From message - keeps update pure!
            }
          }
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════
      // RESTART_QUIZ: complete → idle
      // ═══════════════════════════════════════════════════════════════════
      case "RESTART_QUIZ": {
        if (quiz.status !== "complete") return

        change(doc, draft => {
          draft.quiz.state = {
            status: "idle",
          }
          // Reset score - now possible with plain number instead of Counter
          draft.score.value = 0
        })
        break
      }
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy update function for backwards compatibility
// ═══════════════════════════════════════════════════════════════════════════
// This wraps createQuizUpdate to maintain the old signature.
// New code should use createQuizUpdate directly.

export function update(
  doc: TypedDoc<typeof QuizDocSchema>,
  frontier: Frontiers,
  msg: QuizMsg,
  questions: Question[],
): Frontiers {
  return createQuizUpdate(questions)(doc, frontier, msg)
}
