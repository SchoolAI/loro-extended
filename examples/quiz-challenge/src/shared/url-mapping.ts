import { type Route, UNKNOWN_FRONTIER } from "./view-schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - URL ↔ Route Mapping
// ═══════════════════════════════════════════════════════════════════════════
// Bidirectional mapping between URL paths and Route discriminated unions.
// This enables:
// - Deep linking (share a URL, land on the right page)
// - Browser history integration (back/forward buttons)
// - SEO-friendly URLs (with SSR)
//
// Note: appFrontier is NOT stored in URLs. When parsing a URL, we use
// UNKNOWN_FRONTIER as a placeholder. The app should update the appFrontier
// to the current frontier after initial route parsing.

// ═══════════════════════════════════════════════════════════════════════════
// Route → URL (for browser address bar)
// ═══════════════════════════════════════════════════════════════════════════

export function routeToUrl(route: Route): string {
  switch (route.type) {
    case "home":
      return "/"

    case "quiz": {
      const base = `/quiz/${encodeURIComponent(route.quizId)}`
      // Question review mode is NOT reflected in URL
      // (it's transient UI state, not a shareable location)
      return base
    }

    case "results":
      return `/quiz/${encodeURIComponent(route.quizId)}/results`

    case "settings":
      return "/settings"

    case "history":
      return `/quiz/${encodeURIComponent(route.quizId)}/history`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// URL → Route (for initial load and popstate)
// ═══════════════════════════════════════════════════════════════════════════

export function urlToRoute(url: string): Route {
  // Handle both full URLs and path-only strings
  let pathname: string
  let hash: string

  // Check for hash in the raw URL string first (before URL parsing)
  const hashIndex = url.indexOf("#")
  if (hashIndex !== -1) {
    hash = url.slice(hashIndex)
  } else {
    hash = ""
  }

  try {
    const parsed = new URL(url, "http://localhost")
    pathname = parsed.pathname
    // Use the hash we extracted (URL parsing can be inconsistent with hash)
    if (!hash && parsed.hash) {
      hash = parsed.hash
    }
  } catch {
    // If URL parsing fails, treat as pathname
    pathname = url.split("?")[0]?.split("#")[0] ?? url
  }

  // Normalize pathname (remove trailing slash except for root)
  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1)
  }

  // Legacy support: hash-based quiz ID (e.g., /#demo-quiz)
  // Check this BEFORE the home page check
  if (
    (pathname === "/" || pathname === "") &&
    hash.startsWith("#") &&
    hash.length > 1
  ) {
    const quizId = decodeURIComponent(hash.slice(1))
    return {
      type: "quiz",
      quizId,
      viewingQuestionIndex: null,
      scrollY: 0,
      appFrontier: UNKNOWN_FRONTIER,
    }
  }

  // Home page
  if (pathname === "/" || pathname === "") {
    return { type: "home", scrollY: 0, appFrontier: UNKNOWN_FRONTIER }
  }

  // Settings page
  if (pathname === "/settings") {
    return { type: "settings", scrollY: 0, appFrontier: UNKNOWN_FRONTIER }
  }

  // Quiz results page: /quiz/:quizId/results
  const resultsMatch = pathname.match(/^\/quiz\/([^/]+)\/results$/)
  if (resultsMatch) {
    const quizId = decodeURIComponent(resultsMatch[1] ?? "")
    return {
      type: "results",
      quizId,
      scrollY: 0,
      appFrontier: UNKNOWN_FRONTIER,
    }
  }

  // Quiz history page: /quiz/:quizId/history
  const historyMatch = pathname.match(/^\/quiz\/([^/]+)\/history$/)
  if (historyMatch) {
    const quizId = decodeURIComponent(historyMatch[1] ?? "")
    return {
      type: "history",
      quizId,
      scrollY: 0,
      appFrontier: UNKNOWN_FRONTIER,
    }
  }

  // Quiz page: /quiz/:quizId
  const quizMatch = pathname.match(/^\/quiz\/([^/]+)$/)
  if (quizMatch) {
    const quizId = decodeURIComponent(quizMatch[1] ?? "")
    return {
      type: "quiz",
      quizId,
      viewingQuestionIndex: null, // Always start in live mode
      scrollY: 0,
      appFrontier: UNKNOWN_FRONTIER,
    }
  }

  // Unknown route - go home
  // In a production app, you might want a "not found" route
  return { type: "home", scrollY: 0, appFrontier: UNKNOWN_FRONTIER }
}

// ═══════════════════════════════════════════════════════════════════════════
// URL Comparison (for detecting route changes)
// ═══════════════════════════════════════════════════════════════════════════

export function routesHaveSameUrl(a: Route, b: Route): boolean {
  return routeToUrl(a) === routeToUrl(b)
}

// ═══════════════════════════════════════════════════════════════════════════
// Route Equality (deep comparison)
// ═══════════════════════════════════════════════════════════════════════════

export function routesAreEqual(a: Route, b: Route): boolean {
  if (a.type !== b.type) return false

  switch (a.type) {
    case "home":
    case "settings":
      return a.scrollY === (b as typeof a).scrollY

    case "quiz":
      return (
        a.quizId === (b as typeof a).quizId &&
        a.viewingQuestionIndex === (b as typeof a).viewingQuestionIndex &&
        a.scrollY === (b as typeof a).scrollY
      )

    case "results":
    case "history":
      return (
        a.quizId === (b as typeof a).quizId &&
        a.scrollY === (b as typeof a).scrollY
      )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Get Quiz ID from current URL (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════

export function getQuizIdFromUrl(): string {
  const route = urlToRoute(window.location.href)

  switch (route.type) {
    case "quiz":
    case "results":
    case "history":
      return route.quizId
    default:
      // Default quiz ID for home page or unknown routes
      return "demo-quiz"
  }
}
