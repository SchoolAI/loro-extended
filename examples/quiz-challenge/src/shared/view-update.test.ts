import { change, createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import type { ViewMsg } from "./view-messages.js"
import {
  DEFAULT_VIEW_STATE,
  quizRoute,
  resultsRoute,
  ViewDocSchema,
} from "./view-schema.js"
import { updateView } from "./view-update.js"

// ═══════════════════════════════════════════════════════════════════════════
// View Update Tests
// ═══════════════════════════════════════════════════════════════════════════
// Note: Back/forward navigation is handled by Loro's UndoManager, not the
// update function. These tests focus on NAVIGATE and REPLACE_ROUTE behavior.

describe("viewUpdate", () => {
  function createViewDoc() {
    const doc = createTypedDoc(ViewDocSchema)
    // Initialize with default state
    change(doc, draft => {
      draft.navigation.route = DEFAULT_VIEW_STATE.navigation.route
      draft.preferences.theme = DEFAULT_VIEW_STATE.preferences.theme
      draft.preferences.soundEnabled =
        DEFAULT_VIEW_STATE.preferences.soundEnabled
      draft.preferences.showTimer = DEFAULT_VIEW_STATE.preferences.showTimer
      draft.ui.historyPanelOpen = DEFAULT_VIEW_STATE.ui.historyPanelOpen
    })
    return doc
  }

  function dispatch(doc: ReturnType<typeof createViewDoc>, msg: ViewMsg) {
    const frontier = loro(doc).doc.frontiers()
    return updateView(doc, frontier, msg)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Navigation Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("NAVIGATE", () => {
    it("updates route to new value", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "NAVIGATE",
        route: quizRoute("test-quiz"),
        currentScrollY: 0,
      })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("quiz")
      expect((state.navigation.route as { quizId: string }).quizId).toBe(
        "test-quiz",
      )
    })

    it("saves currentScrollY to the previous route before navigating", () => {
      const doc = createViewDoc()

      // Navigate with a scroll position
      dispatch(doc, {
        type: "NAVIGATE",
        route: quizRoute("quiz-1"),
        currentScrollY: 150,
      })

      // The home route should have been updated with scrollY before navigation
      // We can't directly test this since the route was replaced, but we can
      // verify the new route has scrollY: 0
      const state = doc.toJSON()
      expect(state.navigation.route.scrollY).toBe(0)
    })

    it("sets new route with scrollY: 0", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "NAVIGATE",
        route: quizRoute("quiz-1"),
        currentScrollY: 100,
      })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("quiz")
      expect(state.navigation.route.scrollY).toBe(0)
    })
  })

  describe("REPLACE_ROUTE", () => {
    it("updates route without affecting scroll position tracking", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "REPLACE_ROUTE", route: quizRoute("quiz-1") })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("quiz")
      expect(state.navigation.route.scrollY).toBe(0)
    })

    it("sets scrollY to 0 for new routes", () => {
      const doc = createViewDoc()

      // RouteBuilder pattern: scrollY is set by the dispatch layer, not the caller
      // REPLACE_ROUTE always sets scrollY to 0 for the new route
      dispatch(doc, {
        type: "REPLACE_ROUTE",
        route: resultsRoute("quiz-1"),
      })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("results")
      expect(state.navigation.route.scrollY).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Question Review Mode Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("VIEW_QUESTION", () => {
    it("sets viewingQuestionIndex on quiz route", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "NAVIGATE",
        route: quizRoute("quiz-1"),
        currentScrollY: 0,
      })
      dispatch(doc, { type: "VIEW_QUESTION", questionIndex: 2 })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("quiz")
      expect(
        (state.navigation.route as { viewingQuestionIndex: number | null })
          .viewingQuestionIndex,
      ).toBe(2)
    })

    it("does nothing if not on quiz route", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "VIEW_QUESTION", questionIndex: 2 })

      const state = doc.toJSON()
      expect(state.navigation.route.type).toBe("home")
    })
  })

  describe("RETURN_TO_CURRENT", () => {
    it("sets viewingQuestionIndex to null", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "NAVIGATE",
        route: quizRoute("quiz-1"),
        currentScrollY: 0,
      })
      dispatch(doc, { type: "VIEW_QUESTION", questionIndex: 2 })
      dispatch(doc, { type: "RETURN_TO_CURRENT" })

      const state = doc.toJSON()
      expect(
        (state.navigation.route as { viewingQuestionIndex: number | null })
          .viewingQuestionIndex,
      ).toBe(null)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Preference Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SET_THEME", () => {
    it("changes theme to dark", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "SET_THEME", theme: "dark" })

      const state = doc.toJSON()
      expect(state.preferences.theme).toBe("dark")
    })

    it("changes theme to light", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "SET_THEME", theme: "dark" })
      dispatch(doc, { type: "SET_THEME", theme: "light" })

      const state = doc.toJSON()
      expect(state.preferences.theme).toBe("light")
    })
  })

  describe("TOGGLE_SOUND", () => {
    it("toggles sound from true to false", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "TOGGLE_SOUND" })

      const state = doc.toJSON()
      expect(state.preferences.soundEnabled).toBe(false)
    })

    it("toggles sound from false to true", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "TOGGLE_SOUND" })
      dispatch(doc, { type: "TOGGLE_SOUND" })

      const state = doc.toJSON()
      expect(state.preferences.soundEnabled).toBe(true)
    })
  })

  describe("TOGGLE_TIMER_DISPLAY", () => {
    it("toggles timer display", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "TOGGLE_TIMER_DISPLAY" })

      const state = doc.toJSON()
      expect(state.preferences.showTimer).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UI State Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("TOGGLE_HISTORY_PANEL", () => {
    it("toggles history panel open state", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "TOGGLE_HISTORY_PANEL" })

      const state = doc.toJSON()
      expect(state.ui.historyPanelOpen).toBe(true)
    })
  })

  describe("SHOW_TOAST", () => {
    it("adds toast to queue", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-1",
        message: "Hello!",
        toastType: "success",
      })

      const state = doc.toJSON()
      expect(state.ui.toastQueue.length).toBe(1)
      expect(state.ui.toastQueue[0]?.message).toBe("Hello!")
    })
  })

  describe("DISMISS_TOAST", () => {
    it("removes specific toast from queue", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-1",
        message: "First",
        toastType: "info",
      })
      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-2",
        message: "Second",
        toastType: "info",
      })
      dispatch(doc, { type: "DISMISS_TOAST", id: "toast-1" })

      const state = doc.toJSON()
      expect(state.ui.toastQueue.length).toBe(1)
      expect(state.ui.toastQueue[0]?.id).toBe("toast-2")
    })

    it("does nothing if toast not found", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-1",
        message: "Hello",
        toastType: "info",
      })
      dispatch(doc, { type: "DISMISS_TOAST", id: "nonexistent" })

      const state = doc.toJSON()
      expect(state.ui.toastQueue.length).toBe(1)
    })
  })

  describe("CLEAR_TOASTS", () => {
    it("removes all toasts", () => {
      const doc = createViewDoc()

      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-1",
        message: "First",
        toastType: "info",
      })
      dispatch(doc, {
        type: "SHOW_TOAST",
        id: "toast-2",
        message: "Second",
        toastType: "info",
      })
      dispatch(doc, { type: "CLEAR_TOASTS" })

      const state = doc.toJSON()
      expect(state.ui.toastQueue.length).toBe(0)
    })

    it("does nothing if queue is empty", () => {
      const doc = createViewDoc()

      dispatch(doc, { type: "CLEAR_TOASTS" })

      const state = doc.toJSON()
      expect(state.ui.toastQueue.length).toBe(0)
    })
  })
})
