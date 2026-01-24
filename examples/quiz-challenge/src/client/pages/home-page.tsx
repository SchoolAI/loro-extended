import { quizRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"

// ═══════════════════════════════════════════════════════════════════════════
// Home Page
// ═══════════════════════════════════════════════════════════════════════════
// Landing page with option to start a quiz.
// Time Travel UI is provided by PageLayout wrapper.

export interface HomePageProps {
  viewDispatch: ViewDispatch
}

export function HomePage({ viewDispatch }: HomePageProps) {
  const handleStartQuiz = () => {
    // Navigate to quiz with a default quiz ID
    // In a real app, this might come from a list of available quizzes
    viewDispatch({
      type: "NAVIGATE",
      route: quizRoute("demo-quiz"),
      currentScrollY: window.scrollY,
    })
  }

  return (
    <div className="home-page">
      <div className="home-hero">
        <h1>🎯 Quiz Challenge</h1>
        <p className="home-subtitle">
          Test your knowledge with our interactive quiz powered by LEA 3.0
        </p>
      </div>

      <div className="home-features">
        <div className="feature-card">
          <span className="feature-icon">🔄</span>
          <h3>Real-time Sync</h3>
          <p>Collaborate with others in real-time</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">⏱️</span>
          <h3>Time Travel</h3>
          <p>View and restore any historical state</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">🤖</span>
          <h3>AI Feedback</h3>
          <p>Get instant feedback on your answers</p>
        </div>
      </div>

      <div className="home-actions">
        <button
          type="button"
          className="start-quiz-btn"
          onClick={handleStartQuiz}
        >
          Start Quiz
        </button>
      </div>

      <div className="home-footer">
        <p>
          <strong>LEA 3.0 Demo</strong> — Demonstrating the Reactor Architecture
        </p>
      </div>
    </div>
  )
}
