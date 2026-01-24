import { describe, expect, it } from "vitest"
import {
  routesAreEqual,
  routesHaveSameUrl,
  routeToUrl,
  urlToRoute,
} from "./url-mapping.js"
import {
  getQuizIdFromRoute,
  historyRoute,
  homeRoute,
  quizRoute,
  type Route,
  resultsRoute,
  settingsRoute,
} from "./view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// URL Mapping Tests
// ═══════════════════════════════════════════════════════════════════════════
// Note: Route helper functions are now RouteBuilders that return functions.
// To get a Route, call the builder with (appFrontier, scrollY).
// For tests, we use a test frontier and default scrollY of 0.

const TEST_FRONTIER = "test-frontier"

// Helper to convert RouteBuilder to Route for testing
const toRoute = (builder: ReturnType<typeof homeRoute>): Route =>
  builder(TEST_FRONTIER, 0)

describe("routeToUrl", () => {
  it("converts home route to /", () => {
    expect(routeToUrl(toRoute(homeRoute()))).toBe("/")
  })

  it("converts quiz route to /quiz/:quizId", () => {
    expect(routeToUrl(toRoute(quizRoute("my-quiz")))).toBe("/quiz/my-quiz")
  })

  it("converts quiz route with review mode (ignores viewingQuestionIndex)", () => {
    expect(routeToUrl(toRoute(quizRoute("my-quiz", 2)))).toBe("/quiz/my-quiz")
  })

  it("converts results route to /quiz/:quizId/results", () => {
    expect(routeToUrl(toRoute(resultsRoute("my-quiz")))).toBe(
      "/quiz/my-quiz/results",
    )
  })

  it("converts settings route to /settings", () => {
    expect(routeToUrl(toRoute(settingsRoute()))).toBe("/settings")
  })

  it("converts history route to /quiz/:quizId/history", () => {
    expect(routeToUrl(toRoute(historyRoute("my-quiz")))).toBe(
      "/quiz/my-quiz/history",
    )
  })

  it("encodes special characters in quizId", () => {
    expect(routeToUrl(toRoute(quizRoute("quiz with spaces")))).toBe(
      "/quiz/quiz%20with%20spaces",
    )
  })
})

describe("urlToRoute", () => {
  it("parses / as home route", () => {
    const route = urlToRoute("/")
    expect(route.type).toBe("home")
  })

  it("parses empty string as home route", () => {
    const route = urlToRoute("")
    expect(route.type).toBe("home")
  })

  it("parses /quiz/:quizId as quiz route", () => {
    const route = urlToRoute("/quiz/my-quiz")
    expect(route.type).toBe("quiz")
    expect((route as { quizId: string }).quizId).toBe("my-quiz")
    expect(
      (route as { viewingQuestionIndex: number | null }).viewingQuestionIndex,
    ).toBe(null)
  })

  it("parses /quiz/:quizId/results as results route", () => {
    const route = urlToRoute("/quiz/my-quiz/results")
    expect(route.type).toBe("results")
    expect((route as { quizId: string }).quizId).toBe("my-quiz")
  })

  it("parses /settings as settings route", () => {
    const route = urlToRoute("/settings")
    expect(route.type).toBe("settings")
  })

  it("parses /quiz/:quizId/history as history route", () => {
    const route = urlToRoute("/quiz/my-quiz/history")
    expect(route.type).toBe("history")
    expect((route as { quizId: string }).quizId).toBe("my-quiz")
  })

  it("decodes URL-encoded quizId", () => {
    const route = urlToRoute("/quiz/quiz%20with%20spaces")
    expect(route.type).toBe("quiz")
    expect((route as { quizId: string }).quizId).toBe("quiz with spaces")
  })

  it("handles trailing slashes", () => {
    const route = urlToRoute("/quiz/my-quiz/")
    expect(route.type).toBe("quiz")
    expect((route as { quizId: string }).quizId).toBe("my-quiz")
  })

  it("parses full URLs", () => {
    const route = urlToRoute("http://localhost:3000/quiz/my-quiz")
    expect(route.type).toBe("quiz")
    expect((route as { quizId: string }).quizId).toBe("my-quiz")
  })

  it("handles legacy hash-based quiz ID", () => {
    const route = urlToRoute("/#demo-quiz")
    expect(route.type).toBe("quiz")
    expect((route as { quizId: string }).quizId).toBe("demo-quiz")
  })

  it("returns home for unknown routes", () => {
    const route = urlToRoute("/unknown/path")
    expect(route.type).toBe("home")
  })
})

describe("routesHaveSameUrl", () => {
  it("returns true for same routes", () => {
    expect(
      routesHaveSameUrl(
        toRoute(quizRoute("quiz-1")),
        toRoute(quizRoute("quiz-1")),
      ),
    ).toBe(true)
  })

  it("returns true for quiz routes with different viewingQuestionIndex", () => {
    // viewingQuestionIndex is not reflected in URL
    expect(
      routesHaveSameUrl(
        toRoute(quizRoute("quiz-1", 0)),
        toRoute(quizRoute("quiz-1", 2)),
      ),
    ).toBe(true)
  })

  it("returns false for different quiz IDs", () => {
    expect(
      routesHaveSameUrl(
        toRoute(quizRoute("quiz-1")),
        toRoute(quizRoute("quiz-2")),
      ),
    ).toBe(false)
  })
})

describe("routesAreEqual", () => {
  it("returns true for identical routes", () => {
    expect(
      routesAreEqual(
        toRoute(quizRoute("quiz-1")),
        toRoute(quizRoute("quiz-1")),
      ),
    ).toBe(true)
  })

  it("returns false for different viewingQuestionIndex", () => {
    expect(
      routesAreEqual(
        toRoute(quizRoute("quiz-1", 0)),
        toRoute(quizRoute("quiz-1", 2)),
      ),
    ).toBe(false)
  })

  it("returns false for different route types", () => {
    expect(
      routesAreEqual(
        toRoute(quizRoute("quiz-1")),
        toRoute(resultsRoute("quiz-1")),
      ),
    ).toBe(false)
  })
})

describe("getQuizIdFromRoute", () => {
  it("returns quizId for quiz route", () => {
    expect(getQuizIdFromRoute(toRoute(quizRoute("my-quiz")))).toBe("my-quiz")
  })

  it("returns quizId for results route", () => {
    expect(getQuizIdFromRoute(toRoute(resultsRoute("my-quiz")))).toBe("my-quiz")
  })

  it("returns quizId for history route", () => {
    expect(getQuizIdFromRoute(toRoute(historyRoute("my-quiz")))).toBe("my-quiz")
  })

  it("returns null for home route", () => {
    expect(getQuizIdFromRoute(toRoute(homeRoute()))).toBe(null)
  })

  it("returns null for settings route", () => {
    expect(getQuizIdFromRoute(toRoute(settingsRoute()))).toBe(null)
  })
})

describe("urlToRoute scrollY", () => {
  it("sets scrollY to 0 for all parsed routes", () => {
    expect(urlToRoute("/").scrollY).toBe(0)
    expect(urlToRoute("/quiz/test").scrollY).toBe(0)
    expect(urlToRoute("/quiz/test/results").scrollY).toBe(0)
    expect(urlToRoute("/settings").scrollY).toBe(0)
    expect(urlToRoute("/quiz/test/history").scrollY).toBe(0)
  })
})

describe("routesAreEqual with scrollY", () => {
  it("returns false for same route with different scrollY", () => {
    // Create routes with different scrollY values
    const homeRoute0 = homeRoute()(TEST_FRONTIER, 0)
    const homeRoute100 = homeRoute()(TEST_FRONTIER, 100)
    expect(routesAreEqual(homeRoute0, homeRoute100)).toBe(false)

    const quizRoute0 = quizRoute("quiz-1")(TEST_FRONTIER, 0)
    const quizRoute50 = quizRoute("quiz-1")(TEST_FRONTIER, 50)
    expect(routesAreEqual(quizRoute0, quizRoute50)).toBe(false)
  })

  it("returns true for same route with same scrollY", () => {
    const homeRoute100a = homeRoute()(TEST_FRONTIER, 100)
    const homeRoute100b = homeRoute()(TEST_FRONTIER, 100)
    expect(routesAreEqual(homeRoute100a, homeRoute100b)).toBe(true)

    const quizRoute50a = quizRoute("quiz-1")(TEST_FRONTIER, 50)
    const quizRoute50b = quizRoute("quiz-1")(TEST_FRONTIER, 50)
    expect(routesAreEqual(quizRoute50a, quizRoute50b)).toBe(true)
  })
})

describe("routesHaveSameUrl ignores scrollY", () => {
  it("returns true for same route with different scrollY", () => {
    const homeRoute0 = homeRoute()(TEST_FRONTIER, 0)
    const homeRoute100 = homeRoute()(TEST_FRONTIER, 100)
    expect(routesHaveSameUrl(homeRoute0, homeRoute100)).toBe(true)

    const quizRoute0 = quizRoute("quiz-1")(TEST_FRONTIER, 0)
    const quizRoute50 = quizRoute("quiz-1")(TEST_FRONTIER, 50)
    expect(routesHaveSameUrl(quizRoute0, quizRoute50)).toBe(true)
  })
})
