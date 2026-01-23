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
  resultsRoute,
  settingsRoute,
} from "./view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// URL Mapping Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("routeToUrl", () => {
  it("converts home route to /", () => {
    expect(routeToUrl(homeRoute())).toBe("/")
  })

  it("converts quiz route to /quiz/:quizId", () => {
    expect(routeToUrl(quizRoute("my-quiz"))).toBe("/quiz/my-quiz")
  })

  it("converts quiz route with review mode (ignores viewingQuestionIndex)", () => {
    expect(routeToUrl(quizRoute("my-quiz", 2))).toBe("/quiz/my-quiz")
  })

  it("converts results route to /quiz/:quizId/results", () => {
    expect(routeToUrl(resultsRoute("my-quiz"))).toBe("/quiz/my-quiz/results")
  })

  it("converts settings route to /settings", () => {
    expect(routeToUrl(settingsRoute())).toBe("/settings")
  })

  it("converts history route to /quiz/:quizId/history", () => {
    expect(routeToUrl(historyRoute("my-quiz"))).toBe("/quiz/my-quiz/history")
  })

  it("encodes special characters in quizId", () => {
    expect(routeToUrl(quizRoute("quiz with spaces"))).toBe(
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
    expect(routesHaveSameUrl(quizRoute("quiz-1"), quizRoute("quiz-1"))).toBe(
      true,
    )
  })

  it("returns true for quiz routes with different viewingQuestionIndex", () => {
    // viewingQuestionIndex is not reflected in URL
    expect(
      routesHaveSameUrl(quizRoute("quiz-1", 0), quizRoute("quiz-1", 2)),
    ).toBe(true)
  })

  it("returns false for different quiz IDs", () => {
    expect(routesHaveSameUrl(quizRoute("quiz-1"), quizRoute("quiz-2"))).toBe(
      false,
    )
  })
})

describe("routesAreEqual", () => {
  it("returns true for identical routes", () => {
    expect(routesAreEqual(quizRoute("quiz-1"), quizRoute("quiz-1"))).toBe(true)
  })

  it("returns false for different viewingQuestionIndex", () => {
    expect(routesAreEqual(quizRoute("quiz-1", 0), quizRoute("quiz-1", 2))).toBe(
      false,
    )
  })

  it("returns false for different route types", () => {
    expect(routesAreEqual(quizRoute("quiz-1"), resultsRoute("quiz-1"))).toBe(
      false,
    )
  })
})

describe("getQuizIdFromRoute", () => {
  it("returns quizId for quiz route", () => {
    expect(getQuizIdFromRoute(quizRoute("my-quiz"))).toBe("my-quiz")
  })

  it("returns quizId for results route", () => {
    expect(getQuizIdFromRoute(resultsRoute("my-quiz"))).toBe("my-quiz")
  })

  it("returns quizId for history route", () => {
    expect(getQuizIdFromRoute(historyRoute("my-quiz"))).toBe("my-quiz")
  })

  it("returns null for home route", () => {
    expect(getQuizIdFromRoute(homeRoute())).toBe(null)
  })

  it("returns null for settings route", () => {
    expect(getQuizIdFromRoute(settingsRoute())).toBe(null)
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
    expect(routesAreEqual(homeRoute(0), homeRoute(100))).toBe(false)
    expect(
      routesAreEqual(
        quizRoute("quiz-1", null, 0),
        quizRoute("quiz-1", null, 50),
      ),
    ).toBe(false)
  })

  it("returns true for same route with same scrollY", () => {
    expect(routesAreEqual(homeRoute(100), homeRoute(100))).toBe(true)
    expect(
      routesAreEqual(
        quizRoute("quiz-1", null, 50),
        quizRoute("quiz-1", null, 50),
      ),
    ).toBe(true)
  })
})

describe("routesHaveSameUrl ignores scrollY", () => {
  it("returns true for same route with different scrollY", () => {
    expect(routesHaveSameUrl(homeRoute(0), homeRoute(100))).toBe(true)
    expect(
      routesHaveSameUrl(
        quizRoute("quiz-1", null, 0),
        quizRoute("quiz-1", null, 50),
      ),
    ).toBe(true)
  })
})
