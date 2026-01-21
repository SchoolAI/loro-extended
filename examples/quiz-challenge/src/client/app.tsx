import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import { RepoProvider, useHandle } from "@loro-extended/react"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { QuizDocSchema } from "../shared/schema.js"
import "./styles.css"
import { QuizCard } from "./quiz-card.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Main App
// ═══════════════════════════════════════════════════════════════════════════

const QUIZ_DOC_ID = "demo-quiz"

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
  const handle = useHandle(QUIZ_DOC_ID, QuizDocSchema)

  // Connection status
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")

  useEffect(() => {
    return wsAdapter.subscribe(setConnectionState)
  }, [])

  return (
    <>
      {/* Connection Status */}
      <ConnectionBar state={connectionState} />

      {/* Header */}
      <div className="header">
        <h1>Quiz Challenge — LEA 3.0 Demo</h1>
        <p className="subtitle">
          Demonstrating the Reactor Architecture: Doc, State, Update, Reactors
        </p>
      </div>

      {/* Quiz Card */}
      <QuizCard handle={handle} />

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
