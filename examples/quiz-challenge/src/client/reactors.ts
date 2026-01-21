import type { Dispatch, Reactor } from "../shared/reactor-types.js"
import { entered, exited } from "../shared/reactor-types.js"
import { QUESTION_TIME_LIMIT } from "../shared/update.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Client Reactors
// ═══════════════════════════════════════════════════════════════════════════
//
// These reactors run on the CLIENT (browser). They handle:
// - Timer management (TIME_UP dispatch)
// - Sensor observation (RECEIVE_FEEDBACK dispatch)
// - UI effects (toasts, analytics)

// ═══════════════════════════════════════════════════════════════════════════
// Timer Reactor Factory
// ═══════════════════════════════════════════════════════════════════════════
// Monitors time and dispatches TIME_UP when the question time limit expires.
//
// Pattern: Uses real timestamps (Date.now()) to calculate time remaining.
// This ensures consistent timing across multiple tabs/peers - no TICK messages
// that could cause double-counting when synced.
//
// NOTE: This is a factory function that creates an instance-based reactor.
// This avoids issues with module-level state and React Strict Mode.

export function createTimerReactor(): {
  reactor: Reactor
  cleanup: () => void
} {
  let timerIntervalId: ReturnType<typeof setInterval> | null = null
  let hasDispatchedTimeUp = false
  let currentDispatch: Dispatch | null = null
  let currentStartedAt: number | null = null

  const checkTimeUp = () => {
    if (currentDispatch && currentStartedAt !== null && !hasDispatchedTimeUp) {
      const elapsed = (Date.now() - currentStartedAt) / 1000
      if (elapsed >= QUESTION_TIME_LIMIT) {
        hasDispatchedTimeUp = true
        currentDispatch({ type: "TIME_UP" })
      }
    }
  }

  const reactor: Reactor = ({ before, after }, dispatch) => {
    // Update dispatch reference
    currentDispatch = dispatch

    // Start timer when entering "answering" state
    if (entered("answering", before, after)) {
      hasDispatchedTimeUp = false

      // Clear any existing timer first
      if (timerIntervalId) {
        clearInterval(timerIntervalId)
        timerIntervalId = null
      }

      // Store the startedAt time
      if (after.quiz.state.status === "answering") {
        currentStartedAt = after.quiz.state.startedAt
      }

      // Check for time up every 500ms
      timerIntervalId = setInterval(checkTimeUp, 500)
    }

    // Stop timer when exiting "answering" state
    if (exited("answering", before, after)) {
      if (timerIntervalId) {
        clearInterval(timerIntervalId)
        timerIntervalId = null
      }
      hasDispatchedTimeUp = false
      currentStartedAt = null
    }

    // Also check on every state change (in case we're already past time)
    if (after.quiz.state.status === "answering" && !hasDispatchedTimeUp) {
      currentStartedAt = after.quiz.state.startedAt
      checkTimeUp()
    }
  }

  const cleanup = () => {
    if (timerIntervalId) {
      clearInterval(timerIntervalId)
      timerIntervalId = null
    }
    currentDispatch = null
    currentStartedAt = null
  }

  return { reactor, cleanup }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sensor Reactor
// ═══════════════════════════════════════════════════════════════════════════
// Watches the sensors namespace for AI feedback responses.
// When a response arrives, dispatches RECEIVE_FEEDBACK.
//
// Pattern: Observes sensor data, dispatches messages.
// This is the "sensor → dispatch" pattern.

export const sensorReactor: Reactor = ({ before, after }, dispatch) => {
  // Only check when in "submitted" state
  if (after.quiz.state.status !== "submitted") return

  const requestId = after.quiz.state.requestId
  // Use .get() for Record access with TypedDoc
  const beforeResponse = before.sensors.feedbackResponses.get(requestId)
  const afterResponse = after.sensors.feedbackResponses.get(requestId)

  // Check if response just arrived (wasn't there before, is there now)
  if (!beforeResponse && afterResponse) {
    dispatch({
      type: "RECEIVE_FEEDBACK",
      requestId,
      isCorrect: afterResponse.isCorrect,
      feedback: afterResponse.feedback,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Toast Reactor (Client-side)
// ═══════════════════════════════════════════════════════════════════════════
// Shows toast notifications on certain state transitions.
//
// Pattern: Observes state transitions, performs side effects (DOM).
// This is an "observation reactor" - it doesn't dispatch or write.

export type ToastFn = (
  message: string,
  type: "success" | "error" | "info",
) => void

export function createToastReactor(showToast: ToastFn): Reactor {
  return ({ before, after }) => {
    // Toast when quiz starts
    if (
      entered("answering", before, after) &&
      before.quiz.state.status === "idle"
    ) {
      showToast("Quiz started! Good luck!", "info")
    }

    // Toast when answer is correct/incorrect
    if (entered("reviewing", before, after)) {
      const quiz = after.quiz.state
      if (quiz.status === "reviewing") {
        if (quiz.isCorrect) {
          showToast("🎉 Correct!", "success")
        } else {
          showToast("❌ Incorrect", "error")
        }
      }
    }

    // Toast when quiz is complete
    if (entered("complete", before, after)) {
      const quiz = after.quiz.state
      if (quiz.status === "complete") {
        const percentage = Math.round((quiz.score / quiz.totalQuestions) * 100)
        showToast(`Quiz complete! Score: ${percentage}%`, "info")
      }
    }

    // Toast when time is running low (calculated from startedAt)
    // NOTE: Since we no longer have TICK messages, we can't easily detect
    // crossing the 10s or 5s threshold. The UI will show the countdown,
    // and the timer reactor will handle TIME_UP.
    // For low-time warnings, we'd need a separate interval-based reactor.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Analytics Reactor (Client-side)
// ═══════════════════════════════════════════════════════════════════════════
// Tracks analytics events on state transitions.
//
// Pattern: Observes state transitions, sends to external service.
// This is an "observation reactor" - fire and forget.

export type AnalyticsFn = (event: string, data: Record<string, unknown>) => void

export function createAnalyticsReactor(track: AnalyticsFn): Reactor {
  return ({ before, after }) => {
    // Track quiz start
    if (
      entered("answering", before, after) &&
      before.quiz.state.status === "idle"
    ) {
      track("quiz_started", {})
    }

    // Track answer submission
    if (entered("submitted", before, after)) {
      const quiz = after.quiz.state
      if (quiz.status === "submitted") {
        track("answer_submitted", {
          questionIndex: quiz.questionIndex,
          selectedOption: quiz.selectedOption,
        })
      }
    }

    // Track quiz completion
    if (entered("complete", before, after)) {
      const quiz = after.quiz.state
      if (quiz.status === "complete") {
        track("quiz_completed", {
          score: quiz.score,
          totalQuestions: quiz.totalQuestions,
        })
      }
    }
  }
}
