import { type Infer, Shape } from "@loro-extended/react"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Schema
// ═══════════════════════════════════════════════════════════════════════════
// This schema demonstrates the sensors/actuators pattern for I/O boundary.

// ═══════════════════════════════════════════════════════════════════════════
// Question Schema
// ═══════════════════════════════════════════════════════════════════════════

export const QuestionSchema = Shape.plain.struct({
  id: Shape.plain.string(),
  text: Shape.plain.string(),
  options: Shape.plain.array(Shape.plain.string()),
  correctIndex: Shape.plain.number(),
})

export type Question = Infer<typeof QuestionSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Quiz State - Discriminated Union State Machine
// ═══════════════════════════════════════════════════════════════════════════
//
// State Machine:
//   idle → answering → submitted → reviewing → (next_question | complete)
//            ↑                         │
//            └─────────────────────────┘

export const QuizStateSchema = Shape.plain.discriminatedUnion("status", {
  // Initial state - quiz not started
  idle: Shape.plain.struct({
    status: Shape.plain.string("idle"),
  }),

  // User is answering a question
  // NOTE: We store startedAt (real timestamp) and calculate timeRemaining in the UI.
  // This ensures consistent timing across multiple tabs/peers.
  answering: Shape.plain.struct({
    status: Shape.plain.string("answering"),
    questionIndex: Shape.plain.number(),
    selectedOption: Shape.plain.number().nullable(),
    startedAt: Shape.plain.number(), // Real timestamp (Date.now())
  }),

  // Answer submitted, waiting for AI feedback
  submitted: Shape.plain.struct({
    status: Shape.plain.string("submitted"),
    questionIndex: Shape.plain.number(),
    selectedOption: Shape.plain.number(),
    submittedAt: Shape.plain.number(),
    requestId: Shape.plain.string(),
  }),

  // Reviewing AI feedback
  reviewing: Shape.plain.struct({
    status: Shape.plain.string("reviewing"),
    questionIndex: Shape.plain.number(),
    selectedOption: Shape.plain.number(),
    isCorrect: Shape.plain.boolean(),
    feedback: Shape.plain.string(),
  }),

  // Quiz complete
  complete: Shape.plain.struct({
    status: Shape.plain.string("complete"),
    score: Shape.plain.number(),
    totalQuestions: Shape.plain.number(),
    completedAt: Shape.plain.number(),
  }),
})

export type QuizState = Infer<typeof QuizStateSchema>

// ═══════════════════════════════════════════════════════════════════════════
// AI Feedback Response
// ═══════════════════════════════════════════════════════════════════════════

export const FeedbackResponseSchema = Shape.plain.struct({
  isCorrect: Shape.plain.boolean(),
  feedback: Shape.plain.string(),
  receivedAt: Shape.plain.number(),
})

export type FeedbackResponse = Infer<typeof FeedbackResponseSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Document Schema - The I/O Boundary
// ═══════════════════════════════════════════════════════════════════════════
//
// Structure:
//   - quiz: The state machine (LEA manages this)
//   - questions: The question bank
//   - score: Running score
//   - sensors: External data flows IN here

export const QuizDocSchema = Shape.doc({
  // Application state - wrapped in struct for container compatibility
  quiz: Shape.struct({
    state: QuizStateSchema.placeholder({ status: "idle" }),
  }),

  // Question bank
  questions: Shape.list(
    Shape.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      options: Shape.struct({
        items: Shape.plain.array(Shape.plain.string()),
      }),
      correctIndex: Shape.plain.number(),
    }),
  ),

  // Running score - wrapped in struct since there's no LoroNumber container
  // Server-only: incremented by aiFeedbackReactor, not clients
  score: Shape.struct({
    value: Shape.plain.number(),
  }),

  // Sensors namespace - external systems write here
  sensors: Shape.struct({
    // AI feedback responses keyed by requestId
    feedbackResponses: Shape.record(
      Shape.struct({
        isCorrect: Shape.plain.boolean(),
        feedback: Shape.plain.string(),
        receivedAt: Shape.plain.number(),
      }),
    ),
  }),
})

export type QuizDoc = Infer<typeof QuizDocSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Default questions for initialization
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_QUESTIONS: Question[] = [
  {
    id: "q1",
    text: "What does CRDT stand for?",
    options: [
      "Convergent Replicated Data Type",
      "Centralized Remote Data Transfer",
      "Concurrent Read Data Transaction",
      "Cached Redundant Data Table",
    ],
    correctIndex: 0,
  },
  {
    id: "q2",
    text: "Which property do CRDTs guarantee?",
    options: [
      "Strong consistency",
      "Eventual consistency",
      "Immediate consistency",
      "No consistency",
    ],
    correctIndex: 1,
  },
  {
    id: "q3",
    text: "What is a 'frontier' in Loro?",
    options: [
      "The first operation in history",
      "A point in causal history",
      "The network boundary",
      "A merge conflict",
    ],
    correctIndex: 1,
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// Helper to get current question
// ═══════════════════════════════════════════════════════════════════════════

export function getCurrentQuestion(
  state: QuizDoc,
  questions: Question[],
): Question | null {
  const quiz = state.quiz.state
  if (quiz.status === "idle" || quiz.status === "complete") {
    return null
  }
  return questions[quiz.questionIndex] ?? null
}
