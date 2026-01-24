import type { Handle } from "@loro-extended/react"
import type { HistoryDocSchema } from "../shared/history-schema.js"
import type { QuizDocSchema } from "../shared/schema.js"
import type { Route } from "../shared/view-schema.js"
import type { ViewDispatch } from "./browser-history-reactor.js"
import { PageLayout } from "./page-layout.js"
import { HistoryPage } from "./pages/history-page.js"
import { HomePage } from "./pages/home-page.js"
import { QuizPage } from "./pages/quiz-page.js"
import { ResultsPage } from "./pages/results-page.js"
import { SettingsPage } from "./pages/settings-page.js"

// ═══════════════════════════════════════════════════════════════════════════
// Router Component
// ═══════════════════════════════════════════════════════════════════════════
// Renders the appropriate page based on the current route from View Doc.
// Wraps all pages in PageLayout which provides the Time Travel UI.
//
// Note: With the RouteBuilder pattern, page components no longer need
// getAppFrontier - the dispatch layer handles frontier capture automatically.

export interface RouterProps {
  route: Route
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
  viewDispatch: ViewDispatch
  isDetached: boolean
  onReturnToLive: () => void
}

export function Router({
  route,
  appHandle,
  historyHandle,
  viewDispatch,
  isDetached,
  onReturnToLive,
}: RouterProps) {
  // Wrap page content in PageLayout for shared Time Travel UI
  const wrapInLayout = (content: React.ReactNode) => (
    <PageLayout
      appHandle={appHandle}
      historyHandle={historyHandle}
      isDetached={isDetached}
      onReturnToLive={onReturnToLive}
    >
      {content}
    </PageLayout>
  )

  switch (route.type) {
    case "home":
      return wrapInLayout(<HomePage viewDispatch={viewDispatch} />)

    case "quiz":
      return wrapInLayout(
        <QuizPage
          quizId={route.quizId}
          viewingQuestionIndex={route.viewingQuestionIndex}
          appHandle={appHandle}
          historyHandle={historyHandle}
          viewDispatch={viewDispatch}
        />,
      )

    case "results":
      return wrapInLayout(
        <ResultsPage
          quizId={route.quizId}
          appHandle={appHandle}
          viewDispatch={viewDispatch}
        />,
      )

    case "settings":
      return wrapInLayout(<SettingsPage viewDispatch={viewDispatch} />)

    case "history":
      return wrapInLayout(
        <HistoryPage
          quizId={route.quizId}
          appHandle={appHandle}
          historyHandle={historyHandle}
          viewDispatch={viewDispatch}
        />,
      )

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = route
      return <div>Unknown route</div>
    }
  }
}
