import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import { change, createTypedDoc, loro } from "@loro-extended/change"
import { RepoProvider, useDoc, useHandle } from "@loro-extended/react"
import { UndoManager } from "loro-crdt"
import { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { getHistoryDocId, HistoryDocSchema } from "../shared/history-schema.js"
import { QuizDocSchema } from "../shared/schema.js"
import { urlToRoute } from "../shared/url-mapping.js"
import {
  quizRoute,
  type Route,
  type ViewDoc,
  ViewDocSchema,
} from "../shared/view-schema.js"
import { viewUpdate } from "../shared/view-update.js"
import {
  createBrowserHistoryReactor,
  type ViewDispatch,
} from "./browser-history-reactor.js"
import { Router } from "./router.js"
import "./styles.css"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Main App with View Doc Routing
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_DOC_ID = "demo-quiz"

// Get document ID from URL hash (for test isolation) or use default
function getDocIdFromUrl(): string {
  const hash = window.location.hash.slice(1) // Remove the '#'
  return hash || DEFAULT_DOC_ID
}

// Create WebSocket adapter at module scope
const wsAdapter = createWsClient({
  url: `ws://${location.host}/ws`,
  reconnect: { enabled: true },
})

// ═══════════════════════════════════════════════════════════════════════════
// Connection Status Bar
// ═══════════════════════════════════════════════════════════════════════════

function ConnectionBar({ state }: { state: ConnectionState }) {
  const messages: Record<ConnectionState, string> = {
    connected: "Syncing in real-time",
    connecting: "Connecting...",
    reconnecting: "Reconnecting...",
    disconnected: "Offline — changes will sync when reconnected",
  }

  return (
    <div className={`connection-bar ${state}`}>
      <span className="connection-dot" />
      <span>{messages[state]}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// View Doc Hook
// ═══════════════════════════════════════════════════════════════════════════
// Creates and manages the View Doc (local-only, not synced)

function useViewDoc() {
  // Create View Doc once (local-only, not synced to server)
  const viewDocRef = useRef<ReturnType<
    typeof createTypedDoc<typeof ViewDocSchema>
  > | null>(null)

  if (!viewDocRef.current) {
    viewDocRef.current = createTypedDoc(ViewDocSchema)

    // Initialize route from URL
    const initialRoute = urlToRoute(
      window.location.pathname + window.location.search,
    )
    change(viewDocRef.current, draft => {
      draft.navigation.route = initialRoute
    })
  }

  const viewDoc = viewDocRef.current

  // Create UndoManager for navigation history
  const undoManagerRef = useRef<UndoManager | null>(null)
  if (!undoManagerRef.current) {
    undoManagerRef.current = new UndoManager(loro(viewDoc).doc, {
      maxUndoSteps: 100,
      mergeInterval: 0, // Each navigation is a separate step
    })
  }
  const undoManager = undoManagerRef.current

  // Track route state for re-renders
  const [route, setRoute] = useState<Route>(() => viewDoc.navigation.route)

  // Create viewDispatch function
  const viewDispatch: ViewDispatch = useCallback(
    msg => {
      viewUpdate(viewDoc, loro(viewDoc).doc.frontiers(), msg)
    },
    [viewDoc],
  )

  // Create browser history reactor
  const browserHistoryRef = useRef<{
    reactor: ReturnType<typeof createBrowserHistoryReactor>["reactor"]
    cleanup: () => void
  } | null>(null)

  if (!browserHistoryRef.current) {
    browserHistoryRef.current = createBrowserHistoryReactor(undoManager, {
      replaceOnFirstChange: true,
    })
  }

  // Track previous state for transitions
  const prevStateRef = useRef<ViewDoc>(viewDoc.toJSON() as ViewDoc)

  // Subscribe to View Doc changes and call reactor
  useEffect(() => {
    const unsubscribe = loro(viewDoc).subscribe(() => {
      const after = viewDoc.toJSON() as ViewDoc
      const before = prevStateRef.current

      // Update route state for React
      setRoute(after.navigation.route)

      // Call browser history reactor with transition
      if (browserHistoryRef.current) {
        browserHistoryRef.current.reactor({ before, after }, viewDispatch)
      }

      // Update previous state
      prevStateRef.current = after
    })

    return () => {
      unsubscribe()
      if (browserHistoryRef.current) {
        browserHistoryRef.current.cleanup()
      }
    }
  }, [viewDoc, viewDispatch])

  return { viewDoc, route, viewDispatch, undoManager }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  // Get document ID from URL hash (for test isolation) or use default
  const [docId] = useState(() => getDocIdFromUrl())
  const appHandle = useHandle(docId, QuizDocSchema)

  // History document - separate from app document, NEVER checked out
  const historyHandle = useHandle(getHistoryDocId(docId), HistoryDocSchema)

  // View Doc for routing (local-only)
  const { route, viewDispatch } = useViewDoc()

  // Connection status
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")

  // Detached state (viewing historical state)
  const [isDetached, setIsDetached] = useState(false)

  useEffect(() => {
    return wsAdapter.subscribe(setConnectionState)
  }, [])

  // Track detached state - fires when doc is checked out to historical frontier
  useEffect(() => {
    const checkDetached = () => {
      setIsDetached(loro(appHandle.doc).doc.isDetached())
    }
    checkDetached()
    return loro(appHandle.doc).subscribe(checkDetached)
  }, [appHandle])

  // Return to live state
  const handleReturnToLive = useCallback(() => {
    loro(appHandle.doc).doc.checkoutToLatest()
  }, [appHandle])

  // Cross-doc reactor: auto-navigate to results when quiz completes
  const appDoc = useDoc(appHandle)
  const prevStatusRef = useRef(appDoc.quiz.state.status)

  useEffect(() => {
    const currentStatus = appDoc.quiz.state.status
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = currentStatus

    // Quiz just completed - navigate to results
    if (prevStatus !== "complete" && currentStatus === "complete") {
      // Only navigate if we're on the quiz page
      if (route.type === "quiz") {
        viewDispatch({
          type: "NAVIGATE",
          route: { type: "results", quizId: route.quizId, scrollY: 0 },
          currentScrollY: window.scrollY,
        })
      }
    }

    // Quiz just started - navigate to quiz if on home
    if (prevStatus === "idle" && currentStatus === "answering") {
      if (route.type === "home") {
        viewDispatch({
          type: "NAVIGATE",
          route: quizRoute(docId),
          currentScrollY: window.scrollY,
        })
      }
    }
  }, [appDoc.quiz.state.status, route, viewDispatch, docId])

  return (
    <>
      {/* Connection Status */}
      <ConnectionBar state={connectionState} />

      {/* Navigation Header */}
      <div className="app-header">
        <h1 className="app-title">Quiz Challenge</h1>
        <nav className="app-nav">
          <button
            type="button"
            className={`nav-link ${route.type === "home" ? "active" : ""}`}
            onClick={() =>
              viewDispatch({
                type: "NAVIGATE",
                route: { type: "home", scrollY: 0 },
                currentScrollY: window.scrollY,
              })
            }
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-link ${route.type === "quiz" ? "active" : ""}`}
            onClick={() =>
              viewDispatch({
                type: "NAVIGATE",
                route: quizRoute(docId),
                currentScrollY: window.scrollY,
              })
            }
          >
            Quiz
          </button>
          <button
            type="button"
            className={`nav-link ${route.type === "settings" ? "active" : ""}`}
            onClick={() =>
              viewDispatch({
                type: "NAVIGATE",
                route: { type: "settings", scrollY: 0 },
                currentScrollY: window.scrollY,
              })
            }
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Router - renders the appropriate page based on route */}
      <Router
        route={route}
        appHandle={appHandle}
        historyHandle={historyHandle}
        viewDispatch={viewDispatch}
        isDetached={isDetached}
        onReturnToLive={handleReturnToLive}
      />

      {/* Help Footer */}
      <div className="help-footer">
        <p>
          <strong>Open in another tab</strong> to see real-time collaboration
        </p>
        <p>LEA 3.0 Demo — View Doc Routing with UndoManager</p>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════

const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
