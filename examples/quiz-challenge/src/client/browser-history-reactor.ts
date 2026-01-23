import type { UndoManager } from "loro-crdt"
import {
  routesHaveSameUrl,
  routeToUrl,
  urlToRoute,
} from "../shared/url-mapping.js"
import type { ViewMsg } from "../shared/view-messages.js"
import type { ViewDoc } from "../shared/view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Browser History Reactor
// ═══════════════════════════════════════════════════════════════════════════
// This reactor synchronizes the browser URL with the View Doc route.
// It uses Loro's UndoManager for back/forward navigation:
//
// 1. View Doc route changes → update browser URL (pushState with position)
// 2. Browser popstate events → calculate delta, call undo/redo accordingly
// 3. After undo/redo → restore scroll position from route.scrollY
//
// Key insight: Browser back/forward is conceptually equivalent to undo/redo
// of navigation operations. The UndoManager handles the state restoration.

/**
 * View Doc transition type for reactors
 */
export type ViewTransition = {
  before: ViewDoc
  after: ViewDoc
}

/**
 * View Doc dispatch function type
 */
export type ViewDispatch = (msg: ViewMsg) => void

/**
 * View Doc reactor type
 */
export type ViewReactor = (
  transition: ViewTransition,
  dispatch: ViewDispatch,
) => void | Promise<void>

/**
 * Creates a reactor that syncs browser history with View Doc route.
 * Uses UndoManager for back/forward navigation.
 *
 * @param undoManager The Loro UndoManager for the View Doc
 * @param options Configuration options
 * @returns A reactor function and a cleanup function
 */
export function createBrowserHistoryReactor(
  undoManager: UndoManager,
  options?: {
    /** If true, use replaceState instead of pushState (for initial load) */
    replaceOnFirstChange?: boolean
  },
): {
  reactor: ViewReactor
  cleanup: () => void
} {
  let isFirstChange = options?.replaceOnFirstChange ?? true
  let isHandlingPopstate = false
  let popstateHandler: ((event: PopStateEvent) => void) | null = null

  // Track browser history position for calculating undo/redo count
  let currentPosition = 0

  const reactor: ViewReactor = (transition, _dispatch) => {
    // Set up popstate listener on first call
    if (!popstateHandler) {
      popstateHandler = (event: PopStateEvent) => {
        // Get the position from the state
        const newPosition =
          (event.state as { position?: number } | null)?.position ?? 0
        const delta = newPosition - currentPosition

        // Mark that we're handling popstate to avoid infinite loop
        isHandlingPopstate = true

        if (delta < 0) {
          // Going back - call undo for each step
          for (let i = 0; i < Math.abs(delta); i++) {
            undoManager.undo()
          }
        } else if (delta > 0) {
          // Going forward - call redo for each step
          for (let i = 0; i < delta; i++) {
            undoManager.redo()
          }
        }

        // Update current position
        currentPosition = newPosition

        // Restore scroll position after a microtask to allow DOM to update
        // The scroll position is stored on the route and will be available
        // after the undo/redo operation completes
        queueMicrotask(() => {
          isHandlingPopstate = false
        })
      }

      window.addEventListener("popstate", popstateHandler)

      // Initialize position from current state if available
      const initialState = window.history.state as { position?: number } | null
      if (initialState?.position !== undefined) {
        currentPosition = initialState.position
      }
    }

    // Don't update browser history if we're handling a popstate event
    // (that would cause an infinite loop)
    if (isHandlingPopstate) {
      // After undo/redo, restore scroll position from the route
      const scrollY = transition.after.navigation.route.scrollY
      if (typeof scrollY === "number" && scrollY > 0) {
        window.scrollTo(0, scrollY)
      }
      return
    }

    const { before, after } = transition

    // Check if the route changed (comparing URLs, not full route objects)
    // This ignores viewingQuestionIndex and scrollY changes since they don't affect URL
    if (!routesHaveSameUrl(before.navigation.route, after.navigation.route)) {
      const url = routeToUrl(after.navigation.route)
      const currentUrl = window.location.pathname + window.location.search

      // Only use replaceState if:
      // 1. This is the first change we've seen, AND
      // 2. The new URL matches the current browser URL (initial sync case)
      // Otherwise, always use pushState to create a history entry
      if (isFirstChange && url === currentUrl) {
        // Initial sync: URL already matches, just update state without creating history entry
        window.history.replaceState({ position: currentPosition }, "", url)
        isFirstChange = false
      } else {
        // User navigation: create a new history entry
        isFirstChange = false
        currentPosition++
        window.history.pushState({ position: currentPosition }, "", url)
      }
    }
  }

  const cleanup = () => {
    if (popstateHandler) {
      window.removeEventListener("popstate", popstateHandler)
      popstateHandler = null
    }
  }

  return { reactor, cleanup }
}

/**
 * Initialize the View Doc route from the current browser URL.
 * Call this once at app startup to sync initial state.
 *
 * @param dispatch The View Doc dispatch function
 */
export function initializeRouteFromUrl(dispatch: ViewDispatch): void {
  const route = urlToRoute(window.location.href)

  // Use REPLACE_ROUTE to set initial route without creating an undo step
  dispatch({ type: "REPLACE_ROUTE", route })
}

/**
 * Programmatically navigate to a URL (for link clicks, etc.)
 * This is a convenience function that parses the URL and dispatches NAVIGATE.
 *
 * @param dispatch The View Doc dispatch function
 * @param url The URL to navigate to
 * @param currentScrollY The current scroll position to save
 */
export function navigateToUrl(
  dispatch: ViewDispatch,
  url: string,
  currentScrollY: number = typeof window !== "undefined" ? window.scrollY : 0,
): void {
  const route = urlToRoute(url)
  dispatch({ type: "NAVIGATE", route, currentScrollY })
}
