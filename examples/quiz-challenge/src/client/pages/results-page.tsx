import type { Handle } from "@loro-extended/react"
import { useDoc } from "@loro-extended/react"
import type { QuizDocSchema } from "../../shared/schema.js"
import { homeRoute, quizRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"

// ═══════════════════════════════════════════════════════════════════════════
// Results Page
// ═══════════════════════════════════════════════════════════════════════════
// Shows quiz results after completion.
// Time Travel UI is provided by PageLayout wrapper.

export interface ResultsPageProps {
  quizId: string
  appHandle: Handle<typeof QuizDocSchema>
  viewDispatch: ViewDispatch
}

export function ResultsPage({
  quizId,
  appHandle,
  viewDispatch,
}: ResultsPageProps) {
  const quizDoc = useDoc(appHandle)
  const quizState = quizDoc.quiz.state

  const handleBackToHome = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: homeRoute(),
      currentScrollY: window.scrollY,
    })
  }

  const handleTryAgain = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: quizRoute(quizId),
      currentScrollY: window.scrollY,
    })
  }

  // If quiz is not complete, show a message
  if (quizState.status !== "complete") {
    return (
      <div className="results-page">
        <div className="page-nav">
          <button type="button" className="back-btn" onClick={handleBackToHome}>
            ← Back to Home
          </button>
        </div>
        <div className="results-card">
          <h2>Quiz Not Complete</h2>
          <p>Complete the quiz to see your results.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleTryAgain}
          >
            Go to Quiz
          </button>
        </div>
      </div>
    )
  }

  const { score, totalQuestions } = quizState
  const percentage = Math.round((score / totalQuestions) * 100)

  let emoji = "🎉"
  let message = "Perfect score!"
  if (percentage < 100) {
    emoji = "👏"
    message = "Great job!"
  }
  if (percentage < 70) {
    emoji = "💪"
    message = "Keep practicing!"
  }
  if (percentage < 50) {
    emoji = "📚"
    message = "Time to study more!"
  }

  return (
    <div className="results-page">
      <div className="page-nav">
        <button type="button" className="back-btn" onClick={handleBackToHome}>
          ← Back to Home
        </button>
      </div>

      <div className="results-card">
        <div className="result-emoji">{emoji}</div>
        <h2>{message}</h2>
        <div className="final-score">
          <span className="score-number">{score}</span>
          <span className="score-divider">/</span>
          <span className="score-total">{totalQuestions}</span>
        </div>
        <p className="score-percentage">{percentage}% correct</p>

        <div className="results-actions">
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={handleTryAgain}
          >
            Try Again
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleBackToHome}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
