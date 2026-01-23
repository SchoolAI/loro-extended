import type { Handle } from "@loro-extended/react"
import { useState } from "react"
import type { HistoryDocSchema } from "../../shared/history-schema.js"
import type { QuizDocSchema } from "../../shared/schema.js"
import { homeRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"
import { HistoryPanel } from "../history-panel.js"
import { QuizCard } from "../quiz-card.js"

// ═══════════════════════════════════════════════════════════════════════════
// Quiz Page
// ═══════════════════════════════════════════════════════════════════════════
// Wraps the QuizCard component with page-level navigation.

export interface QuizPageProps {
  quizId: string
  viewingQuestionIndex: number | null
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
  viewDispatch: ViewDispatch
  isDetached: boolean
  onReturnToLive: () => void
}

export function QuizPage({
  quizId: _quizId,
  viewingQuestionIndex: _viewingQuestionIndex,
  appHandle,
  historyHandle,
  viewDispatch,
  isDetached,
  onReturnToLive,
}: QuizPageProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  const handleBackToHome = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: homeRoute(),
      currentScrollY: window.scrollY,
    })
  }

  return (
    <div className="quiz-page">
      {/* Detached State Banner */}
      {isDetached && (
        <div className="detached-banner">
          <span>📜 Viewing historical state</span>
          <button type="button" onClick={onReturnToLive}>
            Return to Live
          </button>
        </div>
      )}

      {/* History Toggle Button */}
      <button
        type="button"
        className="history-toggle-btn"
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        📜 History
      </button>

      {/* History Panel */}
      <HistoryPanel
        appHandle={appHandle}
        historyHandle={historyHandle}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

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
