// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Messages
// ═══════════════════════════════════════════════════════════════════════════
// Messages are pure data describing user intent or system events.
// They flow through the update function to produce state transitions.
//
// KEY PATTERN: Messages that need real time include a `timestamp` field.
// The runtime captures Date.now() when creating the message, keeping
// the update function pure (same message → same state).

export type QuizMsg =
  // User actions
  // NOTE: START_QUIZ and NEXT_QUESTION include timestamp because they
  // initialize the timer's startedAt field.
  | { type: "START_QUIZ"; timestamp: number }
  | { type: "SELECT_OPTION"; optionIndex: number }
  | { type: "SUBMIT_ANSWER" }
  | { type: "NEXT_QUESTION"; timestamp: number }
  | { type: "RESTART_QUIZ" }

  // Timer events (from timer reactor)
  // NOTE: No TICK message - time is calculated from startedAt timestamp
  | { type: "TIME_UP" }

  // Sensor events (from sensor reactor when AI response arrives)
  | {
      type: "RECEIVE_FEEDBACK"
      requestId: string
      isCorrect: boolean
      feedback: string
    }
