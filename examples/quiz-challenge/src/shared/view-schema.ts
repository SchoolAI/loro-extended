import { type Infer, Shape } from "@loro-extended/react"
import type { Frontiers } from "loro-crdt"

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
//
// Each route stores appFrontier - the serialized App Doc frontier at the time
// of navigation. This enables coordinated time travel: when viewing a historical
// view state, we can also restore the corresponding app state.

// ═══════════════════════════════════════════════════════════════════════════
// Frontier Serialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Placeholder for unknown frontier (used when parsing URLs, which don't contain
 * frontier information). The app should update this to the current frontier
 * after initial route parsing.
 */
export const UNKNOWN_FRONTIER = "__UNKNOWN__"

/**
 * Serialize a Loro Frontiers array to a string for storage in routes.
 */
export function serializeFrontier(frontier: Frontiers): string {
  return JSON.stringify(frontier)
}

/**
 * Deserialize a frontier string back to a Loro Frontiers array.
 * Returns null if the string is UNKNOWN_FRONTIER or invalid.
 */
export function deserializeFrontier(str: string): Frontiers | null {
  if (str === UNKNOWN_FRONTIER) return null
  try {
    return JSON.parse(str) as Frontiers
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Route Schema - Discriminated Union for Type-Safe Routing
// ═══════════════════════════════════════════════════════════════════════════
// Each route variant includes:
// - scrollY: for scroll position restoration on undo/redo
// - appFrontier: serialized App Doc frontier for coordinated time travel

export const RouteSchema = Shape.plain.discriminatedUnion("type", {
  // Home page - quiz selection
  home: Shape.plain.struct({
    type: Shape.plain.string("home"),
    scrollY: Shape.plain.number(),
    appFrontier: Shape.plain.string(), // Serialized App Doc frontier
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
    appFrontier: Shape.plain.string(), // Serialized App Doc frontier
  }),

  // Results page - quiz completion summary
  results: Shape.plain.struct({
    type: Shape.plain.string("results"),
    quizId: Shape.plain.string(),
    scrollY: Shape.plain.number(),
    appFrontier: Shape.plain.string(), // Serialized App Doc frontier
  }),

  // Settings page - per-peer preferences
  settings: Shape.plain.struct({
    type: Shape.plain.string("settings"),
    scrollY: Shape.plain.number(),
    appFrontier: Shape.plain.string(), // Serialized App Doc frontier
  }),

  // History page - time travel debugging
  history: Shape.plain.struct({
    type: Shape.plain.string("history"),
    quizId: Shape.plain.string(),
    scrollY: Shape.plain.number(),
    appFrontier: Shape.plain.string(), // Serialized App Doc frontier
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
  // appFrontier stores the App Doc frontier at navigation time for coordinated time travel
  navigation: Shape.struct({
    route: RouteSchema.placeholder({
      type: "home",
      scrollY: 0,
      appFrontier: "",
    }),
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
    route: { type: "home", scrollY: 0, appFrontier: "" },
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

// ═══════════════════════════════════════════════════════════════════════════
// RouteBuilder Pattern
// ═══════════════════════════════════════════════════════════════════════════
// RouteBuilders separate "where to go" (route-specific info) from "when"
// (view capture info like appFrontier and scrollY).
//
// Call sites specify route-specific info:
//   viewDispatch({ type: "NAVIGATE", route: quizRoute("demo-quiz") })
//
// The dispatch layer captures appFrontier and scrollY automatically.

/**
 * A RouteBuilder is a function that takes view capture info and returns a Route.
 * This separates route-specific info (what page, what entity) from view capture
 * info (appFrontier, scrollY) which is handled at the dispatch layer.
 */
export type RouteBuilder = (appFrontier: string, scrollY?: number) => Route

/**
 * Create a quiz route builder
 * @param quizId The quiz ID
 * @param viewingQuestionIndex The question index being viewed (null for live mode)
 */
export function quizRoute(
  quizId: string,
  viewingQuestionIndex: number | null = null,
): RouteBuilder {
  return (appFrontier, scrollY = 0) => ({
    type: "quiz",
    quizId,
    viewingQuestionIndex,
    scrollY,
    appFrontier,
  })
}

/**
 * Create a results route builder
 * @param quizId The quiz ID
 */
export function resultsRoute(quizId: string): RouteBuilder {
  return (appFrontier, scrollY = 0) => ({
    type: "results",
    quizId,
    scrollY,
    appFrontier,
  })
}

/**
 * Create a history route builder
 * @param quizId The quiz ID
 */
export function historyRoute(quizId: string): RouteBuilder {
  return (appFrontier, scrollY = 0) => ({
    type: "history",
    quizId,
    scrollY,
    appFrontier,
  })
}

/**
 * Create a home route builder
 */
export function homeRoute(): RouteBuilder {
  return (appFrontier, scrollY = 0) => ({
    type: "home",
    scrollY,
    appFrontier,
  })
}

/**
 * Create a settings route builder
 */
export function settingsRoute(): RouteBuilder {
  return (appFrontier, scrollY = 0) => ({
    type: "settings",
    scrollY,
    appFrontier,
  })
}

/**
 * Convert a Route back to a RouteBuilder.
 * This is useful when you have a Route (e.g., from URL parsing) and need to
 * dispatch it (which expects a RouteBuilder).
 *
 * The returned RouteBuilder ignores the appFrontier/scrollY parameters and
 * uses the values from the original route. This is intentional for cases like
 * URL parsing where we want to preserve the route's existing values.
 */
export function routeToBuilder(route: Route): RouteBuilder {
  // Return a builder that ignores the parameters and returns the original route
  // This preserves the route's existing appFrontier and scrollY
  return (_appFrontier, _scrollY) => route
}
