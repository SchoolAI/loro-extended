import type { Handle } from "@loro-extended/react"
import type { HistoryDocSchema } from "../../shared/history-schema.js"
import type { QuizDocSchema } from "../../shared/schema.js"
import { homeRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"
import { QuizCard } from "../quiz-card.js"

// ═══════════════════════════════════════════════════════════════════════════
// Quiz Page
// ═══════════════════════════════════════════════════════════════════════════
// Wraps the QuizCard component with page-level navigation.
// Time Travel UI is provided by PageLayout wrapper.

export interface QuizPageProps {
  quizId: string
  viewingQuestionIndex: number | null
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
  viewDispatch: ViewDispatch
}

export function QuizPage({
  quizId: _quizId,
  viewingQuestionIndex: _viewingQuestionIndex,
  appHandle,
  historyHandle,
  viewDispatch,
}: QuizPageProps) {
  const handleBackToHome = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: homeRoute(),
      currentScrollY: window.scrollY,
    })
  }

  return (
    <div className="quiz-page">
      {/* Navigation */}
      <div className="page-nav">
        <button type="button" className="back-btn" onClick={handleBackToHome}>
          ← Back to Home
        </button>
      </div>

      {/* Quiz Card */}
      <QuizCard handle={appHandle} historyHandle={historyHandle} />

      {/* TODO: Question Review Mode - show navigation dots for answered questions */}
      {/* This would use viewingQuestionIndex to show a specific question */}
    </div>
  )
}
