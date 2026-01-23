import type { Route } from "./view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - View Messages
// ═══════════════════════════════════════════════════════════════════════════
// Messages for the View Doc program. These control:
// - Navigation (route changes)
// - Question Review Mode (viewing answered questions)
// - Preferences (theme, sound, timer display)
// - UI state (panels, toasts)
//
// View messages are local-only - they don't sync to other peers.
//
// Note: Back/forward navigation is handled by Loro's UndoManager, not messages.
// The browser history reactor calls undoManager.undo()/redo() directly.

export type ViewMsg =
  // ═══════════════════════════════════════════════════════════════════════════
  // Navigation Messages
  // ═══════════════════════════════════════════════════════════════════════════

  // Navigate to a new route (creates an undo step)
  // currentScrollY captures the scroll position before leaving the current route
  | { type: "NAVIGATE"; route: Route; currentScrollY: number }

  // Replace current route without creating an undo step (for redirects, URL sync)
  | { type: "REPLACE_ROUTE"; route: Route }

  // ═══════════════════════════════════════════════════════════════════════════
  // Question Review Mode Messages
  // ═══════════════════════════════════════════════════════════════════════════

  // View a specific question (enters review mode)
  | { type: "VIEW_QUESTION"; questionIndex: number }

  // Return to viewing the current question (exits review mode)
  | { type: "RETURN_TO_CURRENT" }

  // ═══════════════════════════════════════════════════════════════════════════
  // Preference Messages
  // ═══════════════════════════════════════════════════════════════════════════

  // Set the theme
  | { type: "SET_THEME"; theme: "light" | "dark" }

  // Toggle sound effects
  | { type: "TOGGLE_SOUND" }

  // Toggle timer display
  | { type: "TOGGLE_TIMER_DISPLAY" }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI State Messages
  // ═══════════════════════════════════════════════════════════════════════════

  // Toggle the history panel
  | { type: "TOGGLE_HISTORY_PANEL" }

  // Show a toast notification
  | { type: "SHOW_TOAST"; id: string; message: string; toastType: string }

  // Dismiss a toast notification
  | { type: "DISMISS_TOAST"; id: string }

  // Clear all toasts
  | { type: "CLEAR_TOASTS" }
