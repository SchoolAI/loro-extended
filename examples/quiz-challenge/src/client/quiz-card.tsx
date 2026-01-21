import type { Handle } from "@loro-extended/react"
import { useEffect, useState } from "react"
import type { Question, QuizDocSchema } from "../shared/schema.js"
import { QUESTION_TIME_LIMIT } from "../shared/update.js"
import { type Toast, useQuiz } from "./use-quiz.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - UI Components
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Toast Component
// ═══════════════════════════════════════════════════════════════════════════

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer Display
// ═══════════════════════════════════════════════════════════════════════════

function Timer({ seconds }: { seconds: number }) {
  const isLow = seconds <= 10
  const isCritical = seconds <= 5

  return (
    <div
      className={`timer ${isLow ? "timer-low" : ""} ${isCritical ? "timer-critical" : ""}`}
    >
      ⏱️ {seconds}s
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress Bar
// ═══════════════════════════════════════════════════════════════════════════
// Progress shows how many questions are COMPLETED, not which question you're on.
// - Question 1 of 3: 0% complete (0/3 done)
// - Question 2 of 3: 33% complete (1/3 done)
// - Question 3 of 3: 67% complete (2/3 done)
// - Complete: 100% (3/3 done)

function ProgressBar({ current, total }: { current: number; total: number }) {
  // Progress = completed questions / total questions
  const percentage = (current / total) * 100

  return (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${percentage}%` }} />
      <span className="progress-text">
        Question {current + 1} of {total}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Idle View
// ═══════════════════════════════════════════════════════════════════════════

function IdleView({
  totalQuestions,
  onStart,
}: {
  totalQuestions: number
  onStart: () => void
}) {
  return (
    <div className="quiz-idle">
      <h2>🧠 CRDT Quiz Challenge</h2>
      <p>Test your knowledge of CRDTs and Loro!</p>
      <p className="quiz-info">{totalQuestions} questions • 30 seconds each</p>
      <button
        type="button"
        className="btn btn-primary btn-large"
        onClick={onStart}
      >
        Start Quiz
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Answering View
// ═══════════════════════════════════════════════════════════════════════════

function AnsweringView({
  question,
  questionIndex,
  totalQuestions,
  selectedOption,
  timeRemaining,
  onSelectOption,
  onSubmit,
}: {
  question: Question
  questionIndex: number
  totalQuestions: number
  selectedOption: number | null
  timeRemaining: number
  onSelectOption: (index: number) => void
  onSubmit: () => void
}) {
  return (
    <div className="quiz-answering">
      <div className="quiz-header">
        <ProgressBar current={questionIndex} total={totalQuestions} />
        <Timer seconds={timeRemaining} />
      </div>

      <div className="question">
        <h3>{question.text}</h3>
      </div>

      <div className="options">
        {question.options.map((option, index) => (
          <button
            key={`option-${question.id}-${index}`}
            type="button"
            className={`option ${selectedOption === index ? "option-selected" : ""}`}
            onClick={() => onSelectOption(index)}
          >
            <span className="option-letter">
              {String.fromCharCode(65 + index)}
            </span>
            <span className="option-text">{option}</span>
          </button>
        ))}
      </div>

      <div className="quiz-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={selectedOption === null}
        >
          Submit Answer
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Submitted View (Waiting for AI)
// ═══════════════════════════════════════════════════════════════════════════

function SubmittedView() {
  return (
    <div className="quiz-submitted">
      <div className="loading-spinner" />
      <p>Analyzing your answer...</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Reviewing View
// ═══════════════════════════════════════════════════════════════════════════

function ReviewingView({
  question,
  selectedOption,
  isCorrect,
  feedback,
  onNext,
  isLastQuestion,
}: {
  question: Question
  selectedOption: number
  isCorrect: boolean
  feedback: string
  onNext: () => void
  isLastQuestion: boolean
}) {
  return (
    <div className="quiz-reviewing">
      <div className={`result-banner ${isCorrect ? "correct" : "incorrect"}`}>
        {isCorrect ? "🎉 Correct!" : "❌ Incorrect"}
      </div>

      <div className="question">
        <h3>{question.text}</h3>
      </div>

      <div className="options">
        {question.options.map((option, index) => {
          const isSelected = selectedOption === index
          const isCorrectAnswer = question.correctIndex === index

          let className = "option option-disabled"
          if (isCorrectAnswer) className += " option-correct"
          else if (isSelected && !isCorrect) className += " option-incorrect"

          return (
            <div key={`review-${question.id}-${index}`} className={className}>
              <span className="option-letter">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="option-text">{option}</span>
              {isCorrectAnswer && <span className="option-badge">✓</span>}
              {isSelected && !isCorrectAnswer && (
                <span className="option-badge">✗</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="feedback">
        <p>{feedback}</p>
      </div>

      <div className="quiz-actions">
        <button type="button" className="btn btn-primary" onClick={onNext}>
          {isLastQuestion ? "See Results" : "Next Question"}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Complete View
// ═══════════════════════════════════════════════════════════════════════════

function CompleteView({
  score,
  totalQuestions,
  onRestart,
}: {
  score: number
  totalQuestions: number
  onRestart: () => void
}) {
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
    <div className="quiz-complete">
      <div className="result-emoji">{emoji}</div>
      <h2>{message}</h2>
      <div className="final-score">
        <span className="score-number">{score}</span>
        <span className="score-divider">/</span>
        <span className="score-total">{totalQuestions}</span>
      </div>
      <p className="score-percentage">{percentage}% correct</p>
      <button
        type="button"
        className="btn btn-primary btn-large"
        onClick={onRestart}
      >
        Try Again
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook: Calculate time remaining locally
// ═══════════════════════════════════════════════════════════════════════════
// Time is calculated from startedAt timestamp, not stored in CRDT.
// This ensures consistent timing across multiple tabs/peers.

function useTimeRemaining(startedAt: number | null): number {
  const [timeRemaining, setTimeRemaining] = useState(() => {
    if (startedAt === null) return QUESTION_TIME_LIMIT
    const elapsed = (Date.now() - startedAt) / 1000
    return Math.max(0, Math.ceil(QUESTION_TIME_LIMIT - elapsed))
  })

  useEffect(() => {
    if (startedAt === null) {
      setTimeRemaining(QUESTION_TIME_LIMIT)
      return
    }

    // Calculate initial time remaining
    const calculateRemaining = () => {
      const elapsed = (Date.now() - startedAt) / 1000
      return Math.max(0, Math.ceil(QUESTION_TIME_LIMIT - elapsed))
    }

    setTimeRemaining(calculateRemaining())

    // Update every 100ms for smooth countdown
    const intervalId = setInterval(() => {
      setTimeRemaining(calculateRemaining())
    }, 100)

    return () => clearInterval(intervalId)
  }, [startedAt])

  return timeRemaining
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Quiz Card Component
// ═══════════════════════════════════════════════════════════════════════════

export function QuizCard({ handle }: { handle: Handle<typeof QuizDocSchema> }) {
  const { quizState, currentQuestion, totalQuestions, dispatch, toasts } =
    useQuiz(handle)

  // Calculate time remaining locally from startedAt
  const startedAt =
    quizState.status === "answering" ? quizState.startedAt : null
  const timeRemaining = useTimeRemaining(startedAt)

  const renderContent = () => {
    switch (quizState.status) {
      case "idle":
        return (
          <IdleView
            totalQuestions={totalQuestions}
            onStart={() =>
              dispatch({ type: "START_QUIZ", timestamp: Date.now() })
            }
          />
        )

      case "answering":
        if (!currentQuestion) return null
        return (
          <AnsweringView
            question={currentQuestion}
            questionIndex={quizState.questionIndex}
            totalQuestions={totalQuestions}
            selectedOption={quizState.selectedOption}
            timeRemaining={timeRemaining}
            onSelectOption={index =>
              dispatch({ type: "SELECT_OPTION", optionIndex: index })
            }
            onSubmit={() => dispatch({ type: "SUBMIT_ANSWER" })}
          />
        )

      case "submitted":
        return <SubmittedView />

      case "reviewing":
        if (!currentQuestion) return null
        return (
          <ReviewingView
            question={currentQuestion}
            selectedOption={quizState.selectedOption}
            isCorrect={quizState.isCorrect}
            feedback={quizState.feedback}
            onNext={() =>
              dispatch({ type: "NEXT_QUESTION", timestamp: Date.now() })
            }
            isLastQuestion={quizState.questionIndex >= totalQuestions - 1}
          />
        )

      case "complete":
        return (
          <CompleteView
            score={quizState.score}
            totalQuestions={quizState.totalQuestions}
            onRestart={() => dispatch({ type: "RESTART_QUIZ" })}
          />
        )
    }
  }

  return (
    <div className="quiz-card">
      {renderContent()}
      <ToastContainer toasts={toasts} />
    </div>
  )
}
