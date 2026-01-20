import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import { RepoProvider, useHandle } from "@loro-extended/react"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { TaskDocSchema } from "./schema.js"
import "./styles.css"
import { TaskCard } from "./task-card.js"

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const TASK_DOC_ID = "demo-task"

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
// State Diagram Component
// ═══════════════════════════════════════════════════════════════════════════

function StateDiagram() {
  return (
    <div className="state-diagram">
      <h3>State Machine</h3>
      <pre>{`
  draft ──▶ todo ──▶ in_progress ──▶ done
              │           │            │
              │           ▼            │
              │       blocked ─────────┘
              │           │
              └───────────┴──────────▶ archived
      `}</pre>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main App Component
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  const handle = useHandle(TASK_DOC_ID, TaskDocSchema)

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
        <h1>Task Card — LEA Demo</h1>
      </div>

      {/* Task Card */}
      <TaskCard handle={handle} />

      {/* State Diagram */}
      <StateDiagram />

      {/* Help Footer */}
      <div className="help-footer">
        <p>
          <strong>Open in another tab</strong> to see real-time collaboration
        </p>
        <p>
          <span className="shortcut">⌘Z</span> undo{" "}
          <span className="shortcut">⌘⇧Z</span> redo
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
