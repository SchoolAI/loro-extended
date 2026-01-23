import { type Infer, Shape } from "@loro-extended/react"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - View Doc Schema
// ═══════════════════════════════════════════════════════════════════════════
// The View Doc holds per-peer state that is NOT synced to other peers:
// - Current route (what page am I on)
// - UI preferences (theme, sound)
// - Transient UI state (panels, toasts)
//
// Navigation history is handled by Loro's UndoManager, not manual stacks.
// This is orthogonal to the App Doc which holds shared collaborative state.

// ═══════════════════════════════════════════════════════════════════════════
// Route Schema - Discriminated Union for Type-Safe Routing
// ═══════════════════════════════════════════════════════════════════════════
// Each route variant includes scrollY for scroll position restoration.
// When UndoManager reverts a route change, scroll position is restored too.

export const RouteSchema = Shape.plain.discriminatedUnion("type", {
  // Home page - quiz selection
  home: Shape.plain.struct({
    type: Shape.plain.string("home"),
    scrollY: Shape.plain.number(),
  }),

  // Quiz page - taking a quiz
  quiz: Shape.plain.struct({
    type: Shape.plain.string("quiz"),
    quizId: Shape.plain.string(),
    // Question Review Mode: which question are we VIEWING
    // null = viewing current question (live mode)
    // number = viewing a specific answered question (review mode)
    viewingQuestionIndex: Shape.plain.number().nullable(),
    scrollY: Shape.plain.number(),
  }),

  // Results page - quiz completion summary
  results: Shape.plain.struct({
    type: Shape.plain.string("results"),
    quizId: Shape.plain.string(),
    scrollY: Shape.plain.number(),
  }),

  // Settings page - per-peer preferences
  settings: Shape.plain.struct({
    type: Shape.plain.string("settings"),
    scrollY: Shape.plain.number(),
  }),

  // History page - time travel debugging
  history: Shape.plain.struct({
    type: Shape.plain.string("history"),
    quizId: Shape.plain.string(),
    scrollY: Shape.plain.number(),
  }),
})

export type Route = Infer<typeof RouteSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Toast Schema - For notification queue
// ═══════════════════════════════════════════════════════════════════════════

export const ToastSchema = Shape.struct({
  id: Shape.plain.string(),
  message: Shape.plain.string(),
  toastType: Shape.plain.string(), // "success" | "error" | "info"
})

export type ViewToast = Infer<typeof ToastSchema>

// ═══════════════════════════════════════════════════════════════════════════
// View Doc Schema - Per-Peer Viewport State
// ═══════════════════════════════════════════════════════════════════════════
// Navigation history is handled by Loro's UndoManager, not manual stacks.
// The UndoManager automatically tracks route changes and can undo/redo them.

export const ViewDocSchema = Shape.doc({
  // Current route - what page am I on
  // Wrapped in struct for container compatibility
  // scrollY is stored on the route for automatic restoration on undo/redo
  navigation: Shape.struct({
    route: RouteSchema.placeholder({ type: "home", scrollY: 0 }),
  }),

  // Per-peer preferences (not synced)
  preferences: Shape.struct({
    theme: Shape.plain.string(), // "light" | "dark"
    soundEnabled: Shape.plain.boolean(),
    showTimer: Shape.plain.boolean(),
  }),

  // Transient UI state
  ui: Shape.struct({
    historyPanelOpen: Shape.plain.boolean(),
    toastQueue: Shape.list(ToastSchema),
  }),
})

export type ViewDoc = Infer<typeof ViewDocSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Default View State
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_VIEW_STATE: ViewDoc = {
  navigation: {
    route: { type: "home", scrollY: 0 },
  },
  preferences: {
    theme: "light",
    soundEnabled: true,
    showTimer: true,
  },
  ui: {
    historyPanelOpen: false,
    toastQueue: [],
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if we're in Question Review Mode
 */
export function isInReviewMode(route: Route): boolean {
  return route.type === "quiz" && route.viewingQuestionIndex !== null
}

/**
 * Get the quiz ID from a route, if applicable
 */
export function getQuizIdFromRoute(route: Route): string | null {
  switch (route.type) {
    case "quiz":
    case "results":
    case "history":
      return route.quizId
    default:
      return null
  }
}

/**
 * Create a quiz route
 * @param quizId The quiz ID
 * @param viewingQuestionIndex The question index being viewed (null for live mode)
 * @param scrollY The scroll position (defaults to 0)
 */
export function quizRoute(
  quizId: string,
  viewingQuestionIndex: number | null = null,
  scrollY: number = 0,
): Route {
  return { type: "quiz", quizId, viewingQuestionIndex, scrollY }
}

/**
 * Create a results route
 * @param quizId The quiz ID
 * @param scrollY The scroll position (defaults to 0)
 */
export function resultsRoute(quizId: string, scrollY: number = 0): Route {
  return { type: "results", quizId, scrollY }
}

/**
 * Create a history route
 * @param quizId The quiz ID
 * @param scrollY The scroll position (defaults to 0)
 */
export function historyRoute(quizId: string, scrollY: number = 0): Route {
  return { type: "history", quizId, scrollY }
}

/**
 * Create a home route
 * @param scrollY The scroll position (defaults to 0)
 */
export function homeRoute(scrollY: number = 0): Route {
  return { type: "home", scrollY }
}

/**
 * Create a settings route
 * @param scrollY The scroll position (defaults to 0)
 */
export function settingsRoute(scrollY: number = 0): Route {
  return { type: "settings", scrollY }
}
