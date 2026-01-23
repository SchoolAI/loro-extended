import { change, type Frontiers, type TypedDoc } from "@loro-extended/change"
import { createUpdate } from "./update.js"
import type { ViewMsg } from "./view-messages.js"
import type { Route, ViewDocSchema } from "./view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - View Update Function
// ═══════════════════════════════════════════════════════════════════════════
// The view update function handles all View Doc state transitions.
// It follows the same fork-and-merge pattern as the App update.
//
// Navigation history is handled by Loro's UndoManager, not manual stacks.
// The NAVIGATE message creates two separate changes:
// 1. Update the current route's scrollY (so undo restores scroll position)
// 2. Replace the route with the new route
// This ensures UndoManager captures both operations for proper undo/redo.

// ═══════════════════════════════════════════════════════════════════════════
// View Update Factory
// ═══════════════════════════════════════════════════════════════════════════

export const viewUpdate = createUpdate<typeof ViewDocSchema, ViewMsg>(
  (doc, msg, _timestamp) => {
    switch (msg.type) {
      // ═══════════════════════════════════════════════════════════════════════
      // NAVIGATE: Go to a new route (creates undo step for back/forward)
      // ═══════════════════════════════════════════════════════════════════════
      case "NAVIGATE": {
        // Step 1: Save scroll position to current route before leaving
        // This ensures undo restores both the route AND scroll position
        change(doc, draft => {
          ;(draft.navigation.route as Route).scrollY = msg.currentScrollY
        })

        // Step 2: Navigate to new route with scrollY: 0
        change(doc, draft => {
          draft.navigation.route = msg.route
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // REPLACE_ROUTE: Replace current route without creating undo step
      // Used for URL sync, redirects, and initial route setup
      // ═══════════════════════════════════════════════════════════════════════
      case "REPLACE_ROUTE": {
        change(doc, draft => {
          draft.navigation.route = msg.route
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // VIEW_QUESTION: Enter question review mode
      // ═══════════════════════════════════════════════════════════════════════
      case "VIEW_QUESTION": {
        const route = doc.navigation.route
        if (route.type !== "quiz") return // Only works on quiz page

        change(doc, draft => {
          // TypeScript knows this is a quiz route after the guard
          ;(
            draft.navigation.route as Route & { type: "quiz" }
          ).viewingQuestionIndex = msg.questionIndex
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // RETURN_TO_CURRENT: Exit question review mode
      // ═══════════════════════════════════════════════════════════════════════
      case "RETURN_TO_CURRENT": {
        const route = doc.navigation.route
        if (route.type !== "quiz") return // Only works on quiz page

        change(doc, draft => {
          ;(
            draft.navigation.route as Route & { type: "quiz" }
          ).viewingQuestionIndex = null
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SET_THEME: Change the color theme
      // ═══════════════════════════════════════════════════════════════════════
      case "SET_THEME": {
        change(doc, draft => {
          draft.preferences.theme = msg.theme
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // TOGGLE_SOUND: Toggle sound effects
      // ═══════════════════════════════════════════════════════════════════════
      case "TOGGLE_SOUND": {
        change(doc, draft => {
          draft.preferences.soundEnabled = !doc.preferences.soundEnabled
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // TOGGLE_TIMER_DISPLAY: Toggle timer visibility
      // ═══════════════════════════════════════════════════════════════════════
      case "TOGGLE_TIMER_DISPLAY": {
        change(doc, draft => {
          draft.preferences.showTimer = !doc.preferences.showTimer
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // TOGGLE_HISTORY_PANEL: Toggle the history panel
      // ═══════════════════════════════════════════════════════════════════════
      case "TOGGLE_HISTORY_PANEL": {
        change(doc, draft => {
          draft.ui.historyPanelOpen = !doc.ui.historyPanelOpen
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SHOW_TOAST: Add a toast to the queue
      // ═══════════════════════════════════════════════════════════════════════
      case "SHOW_TOAST": {
        change(doc, draft => {
          draft.ui.toastQueue.push({
            id: msg.id,
            message: msg.message,
            toastType: msg.toastType,
          })
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DISMISS_TOAST: Remove a specific toast
      // ═══════════════════════════════════════════════════════════════════════
      case "DISMISS_TOAST": {
        const toastIndex = doc.ui.toastQueue.findIndex(t => t.id === msg.id)
        if (toastIndex === -1) return

        change(doc, draft => {
          draft.ui.toastQueue.delete(toastIndex, 1)
        })
        break
      }

      // ═══════════════════════════════════════════════════════════════════════
      // CLEAR_TOASTS: Remove all toasts
      // ═══════════════════════════════════════════════════════════════════════
      case "CLEAR_TOASTS": {
        const toastLen = doc.ui.toastQueue.length
        if (toastLen === 0) return

        change(doc, draft => {
          draft.ui.toastQueue.delete(0, toastLen)
        })
        break
      }
    }
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// Wrapper function for explicit doc parameter
// ═══════════════════════════════════════════════════════════════════════════

export function updateView(
  doc: TypedDoc<typeof ViewDocSchema>,
  frontier: Frontiers,
  msg: ViewMsg,
): Frontiers {
  return viewUpdate(doc, frontier, msg)
}
