import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import { loro } from "@loro-extended/change"
import { RepoProvider, useHandle } from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { getHistoryDocId, HistoryDocSchema } from "../shared/history-schema.js"
import { QuizDocSchema } from "../shared/schema.js"
import "./styles.css"
import { HistoryPanel } from "./history-panel.js"
import { QuizCard } from "./quiz-card.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Main App
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
// Architecture Diagram
// ═══════════════════════════════════════════════════════════════════════════

function ArchitectureDiagram() {
  return (
    <div className="architecture-diagram">
      <h3>LEA 3.0 Architecture</h3>
      <pre>{`
  ┌─────────────────────────────────────────────────────┐
  │                    LEA 3.0                          │
  │                                                     │
  │   Doc ──▶ State ──▶ Update ──▶ Reactors             │
  │                                                     │
  │   Reactors:                                         │
  │   • View (renders UI)                               │
  │   • Timer (dispatches TICK)                         │
  │   • Sensor (dispatches on AI response)              │
  │   • AI Effect (writes to sensors)                   │
  │   • Toast (shows notifications)                     │
  └─────────────────────────────────────────────────────┘
      `}</pre>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  // Get document ID from URL hash (for test isolation) or use default
  const [docId] = useState(() => getDocIdFromUrl())
  const handle = useHandle(docId, QuizDocSchema)

  // History document - separate from app document, NEVER checked out
  // This ensures the history panel always receives updates from peers
  const historyHandle = useHandle(getHistoryDocId(docId), HistoryDocSchema)

  // Connection status
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")

  // History panel state
  const [historyOpen, setHistoryOpen] = useState(false)

  // Detached state (viewing historical state)
  const [isDetached, setIsDetached] = useState(false)

  useEffect(() => {
    return wsAdapter.subscribe(setConnectionState)
  }, [])

  // Track detached state - fires when doc is checked out to historical frontier
  useEffect(() => {
    const checkDetached = () => {
      setIsDetached(loro(handle.doc).doc.isDetached())
    }
    checkDetached()
    return loro(handle.doc).subscribe(checkDetached)
  }, [handle])

  // Return to live state
  const handleReturnToLive = useCallback(() => {
    loro(handle.doc).doc.checkoutToLatest()
  }, [handle])

  return (
    <>
      {/* Detached State Banner */}
      {isDetached && (
        <div className="detached-banner">
          <span>📜 Viewing historical state</span>
          <button type="button" onClick={handleReturnToLive}>
            Return to Live
          </button>
        </div>
      )}

      {/* Connection Status */}
      <ConnectionBar state={connectionState} />

      {/* History Toggle Button */}
      <button
        type="button"
        className="history-toggle-btn"
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        📜 History
      </button>

      {/* History Panel */}
      <HistoryPanel
        appHandle={handle}
        historyHandle={historyHandle}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Header */}
      <div className="header">
        <h1>Quiz Challenge — LEA 3.0 Demo</h1>
        <p className="subtitle">
          Demonstrating the Reactor Architecture: Doc, State, Update, Reactors
        </p>
      </div>

      {/* Quiz Card */}
      <QuizCard handle={handle} historyHandle={historyHandle} />

      {/* Architecture Diagram */}
      <ArchitectureDiagram />

      {/* Help Footer */}
      <div className="help-footer">
        <p>
          <strong>Open in another tab</strong> to see real-time collaboration
        </p>
        <p>
          This demo shows LEA 3.0's unified reactor pattern for views,
          subscriptions, and effects.
        </p>
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
