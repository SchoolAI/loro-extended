import type { TypedDoc } from "@loro-extended/change"
import type { QuizDocSchema } from "../shared/schema.js"
import { quizRoute, resultsRoute } from "../shared/view-schema.js"
import type { ViewDispatch } from "./browser-history-reactor.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Cross-Doc Reactor
// ═══════════════════════════════════════════════════════════════════════════
// This reactor coordinates between the App Doc and View Doc.
// It watches App Doc transitions and dispatches View Doc messages.
//
// Key insight: Cross-doc reactors enable coordination between orthogonal
// state spaces without coupling them. The App Doc doesn't know about routing;
// the View Doc doesn't know about quiz logic. This reactor bridges them.
//
// Example: When quiz completes → navigate to results page

/**
 * App Doc transition type
 */
export type AppTransition = {
  before: TypedDoc<typeof QuizDocSchema>
  after: TypedDoc<typeof QuizDocSchema>
}

/**
 * Creates a reactor that watches App Doc transitions and dispatches
 * View Doc messages for cross-doc coordination.
 *
 * @param viewDispatch The View Doc dispatch function
 * @param quizId The current quiz ID (for building routes)
 * @param getCurrentScrollY Function to get current scroll position
 * @returns A reactor function for the App Doc
 */
export function createCrossDocReactor(
  viewDispatch: ViewDispatch,
  quizId: string,
  getCurrentScrollY: () => number = () =>
    typeof window !== "undefined" ? window.scrollY : 0,
): (transition: AppTransition) => void {
  return (transition: AppTransition) => {
    const { before, after } = transition

    // ═══════════════════════════════════════════════════════════════════════
    // Quiz Completion → Navigate to Results
    // ═══════════════════════════════════════════════════════════════════════
    // When the quiz transitions to "complete" status, automatically navigate
    // to the results page. This is a cross-doc coordination pattern.

    const wasComplete = before.quiz.state.status === "complete"
    const isComplete = after.quiz.state.status === "complete"

    if (!wasComplete && isComplete) {
      // Quiz just completed - navigate to results
      viewDispatch({
        type: "NAVIGATE",
        route: resultsRoute(quizId),
        currentScrollY: getCurrentScrollY(),
      })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Quiz Reset → Navigate to Quiz Page
    // ═══════════════════════════════════════════════════════════════════════
    // When the quiz is reset (transitions from complete to idle), navigate
    // back to the quiz page.

    const wasIdle = before.quiz.state.status === "idle"
    const isIdle = after.quiz.state.status === "idle"

    if (!wasIdle && isIdle && wasComplete) {
      // Quiz was reset from complete - navigate back to quiz
      viewDispatch({
        type: "NAVIGATE",
        route: quizRoute(quizId),
        currentScrollY: getCurrentScrollY(),
      })
    }
  }
}

/**
 * Creates a toast notification reactor that shows toasts on quiz events.
 *
 * @param viewDispatch The View Doc dispatch function
 * @returns A reactor function for the App Doc
 */
export function createToastReactor(
  viewDispatch: ViewDispatch,
): (transition: AppTransition) => void {
  let toastCounter = 0

  return (transition: AppTransition) => {
    const { before, after } = transition

    // Show toast when answer is correct
    if (
      before.quiz.state.status === "submitted" &&
      after.quiz.state.status === "reviewing"
    ) {
      const isCorrect =
        after.quiz.state.status === "reviewing" && after.quiz.state.isCorrect

      if (isCorrect) {
        viewDispatch({
          type: "SHOW_TOAST",
          id: `toast-${++toastCounter}`,
          message: "🎉 Correct!",
          toastType: "success",
        })
      }
    }

    // Show toast when quiz completes
    const wasComplete = before.quiz.state.status === "complete"
    const isComplete = after.quiz.state.status === "complete"

    if (!wasComplete && isComplete) {
      const state = after.quiz.state
      if (state.status === "complete") {
        const percentage = Math.round(
          (state.score / state.totalQuestions) * 100,
        )
        viewDispatch({
          type: "SHOW_TOAST",
          id: `toast-${++toastCounter}`,
          message: `Quiz complete! Score: ${percentage}%`,
          toastType: percentage >= 70 ? "success" : "info",
        })
      }
    }
  }
}
