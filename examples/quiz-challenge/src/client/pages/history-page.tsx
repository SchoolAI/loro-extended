import type { Handle } from "@loro-extended/react"
import type { HistoryDocSchema } from "../../shared/history-schema.js"
import type { QuizDocSchema } from "../../shared/schema.js"
import { homeRoute, quizRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"
import { HistoryPanel } from "../history-panel.js"

// ═══════════════════════════════════════════════════════════════════════════
// History Page
// ═══════════════════════════════════════════════════════════════════════════
// Full-page view of quiz history (time travel).

export interface HistoryPageProps {
  quizId: string
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
  viewDispatch: ViewDispatch
}

export function HistoryPage({
  quizId,
  appHandle,
  historyHandle,
  viewDispatch,
}: HistoryPageProps) {
  const handleBackToQuiz = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: quizRoute(quizId),
      currentScrollY: window.scrollY,
    })
  }

  const handleBackToHome = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: homeRoute(),
      currentScrollY: window.scrollY,
    })
  }

  return (
    <div className="history-page">
      <div className="page-nav">
        <button type="button" className="back-btn" onClick={handleBackToHome}>
          ← Back to Home
        </button>
        <button type="button" className="back-btn" onClick={handleBackToQuiz}>
          Back to Quiz
        </button>
      </div>

      <div className="history-page-content">
        <h2>📜 Quiz History</h2>
        <p>View and restore previous states of the quiz.</p>

        {/* Reuse the existing HistoryPanel component */}
        <HistoryPanel
          appHandle={appHandle}
          historyHandle={historyHandle}
          isOpen={true}
          onClose={() => {
            /* no-op for full page view */
          }}
        />
      </div>
    </div>
  )
}
