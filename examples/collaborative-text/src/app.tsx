import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import {
  type CounterRef,
  type Infer,
  RepoProvider,
  Shape,
  type TextRef,
  useCollaborativeText,
  useDocument,
  usePlaceholder,
  useUndoManager,
  useValue,
} from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

// Document IDs
const SETTINGS_DOC_ID = "shared-form-settings"
const FORM_DOC_ID = "shared-form"

// Create WebSocket adapter at module scope so it's accessible for interceptors
const wsAdapter = createWsClient({
  url: `ws://${location.host}/ws`,
  reconnect: { enabled: true },
})

type TextApproach = "last-write-wins" | "collaborative"

// Settings schema - synced instantly (no delay)
const SettingsSchema = Shape.doc({
  settings: Shape.struct({
    textApproach: Shape.plain
      .string<TextApproach>()
      .placeholder("collaborative"),
    networkDelay: Shape.counter().placeholder(0), // Network delay in ms (0-10000)
  }),
})

// ============================================
// Form Schema
// ============================================
// This schema demonstrates the two categories of form controls:
//
// 1. ATOMIC CONTROLS (status, priority)
//    - Use `useValue` - values are discrete/atomic
//    - "Last-write-wins" is intuitive for dropdowns, checkboxes, counters
//    - Example: If User A selects "review" and User B selects "published"
//      during a network partition, one must win - there's no meaningful merge
//
// 2. TEXT CONTROLS (title, description, notes)
//    - Can use either `useValue` or `useCollaborativeText`
//    - useValue: Simpler, replaces entire text on each keystroke
//    - useCollaborativeText: Character-level operations preserve user intent
//    - Choose based on whether concurrent editing is expected
//
const FormSchema = Shape.doc({
  // Atomic controls - always use useValue
  status: Shape.text().placeholder("draft"), // Dropdown selection
  priority: Shape.counter(), // Numeric counter (0-5)

  // Text controls - choice depends on collaboration pattern
  title: Shape.text().placeholder("Untitled Document"), // Short text
  description: Shape.text().placeholder("Enter a description..."), // Long text
  notes: Shape.text().placeholder("Add some notes..."), // Long text
})

/**
 * Helper to extract docId from a channel message.
 */
function getDocIdFromMessage(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined
  const msg = message as Record<string, unknown>

  if ("docId" in msg && typeof msg.docId === "string") {
    return msg.docId
  }

  if (
    msg.type === "channel/batch" &&
    Array.isArray(msg.messages) &&
    msg.messages.length > 0
  ) {
    return getDocIdFromMessage(msg.messages[0])
  }

  return undefined
}

// ============================================
// Connection Status Bar
// ============================================

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

// ============================================
// Atomic Controls - Always use useValue
// ============================================
// These controls have discrete/atomic values where "last-write-wins"
// is the intuitive and expected behavior during concurrent edits.
//
// StatusDropdown: A dropdown selection is atomic - there's no meaningful
// "merge" of two different selections. If User A selects "review" and
// User B selects "published" during a network partition, one must win.
//
// PrioritySelector: Uses CounterRef where concurrent increments/decrements
// merge naturally via CRDT semantics. The UI shows a single value.

/**
 * Status Dropdown - demonstrates useValue for atomic selection.
 */
function StatusDropdown({ statusRef }: { statusRef: TextRef }) {
  const value = useValue(statusRef)

  return (
    <select
      value={value}
      onChange={e => statusRef.update(e.target.value)}
      className="status-dropdown"
    >
      <option value="draft">📝 Draft</option>
      <option value="review">👀 In Review</option>
      <option value="published">✅ Published</option>
    </select>
  )
}

/**
 * Priority Selector - demonstrates useValue with CounterRef.
 * CRDT counter handles concurrent increments/decrements automatically.
 */
function PrioritySelector({ priorityRef }: { priorityRef: CounterRef }) {
  const value = useValue(priorityRef) as number
  const displayValue = Math.max(0, Math.min(5, value))

  return (
    <div className="priority-selector">
      <button
        type="button"
        onClick={() => priorityRef.decrement(1)}
        disabled={displayValue <= 0}
        className="priority-btn"
      >
        −
      </button>
      <span className="priority-value">
        {"★".repeat(displayValue)}
        {"☆".repeat(5 - displayValue)}
      </span>
      <button
        type="button"
        onClick={() => priorityRef.increment(1)}
        disabled={displayValue >= 5}
        className="priority-btn"
      >
        +
      </button>
    </div>
  )
}

// ============================================
// Text Controls - Choice depends on collaboration pattern
// ============================================
//
// useValue (RefValueInput):
//   - Controlled inputs with automatic value/placeholder
//   - Best for: Single-user sync, form fields, settings
//   - Tradeoff: Replaces entire text on each keystroke, which can produce
//     unexpected merges during concurrent editing
//
// useCollaborativeText (CollaborativeInput/CollaborativeTextarea):
//   - Uncontrolled inputs with fine-grained CRDT operations
//   - Best for: Real-time collaboration, document editing
//   - Benefit: Character-level operations preserve user intent during merges
//
// NOTE: With automatic cursor restoration built into RepoProvider,
// undo/redo will restore cursor position to the correct field automatically.

/**
 * RefValueInput - Controlled input using useValue.
 * Simpler code, but replaces entire text on each keystroke.
 */
function RefValueInput({
  textRef,
  multiline = false,
}: {
  textRef: TextRef
  multiline?: boolean
}) {
  const value = useValue(textRef)
  const placeholder = usePlaceholder(textRef)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      textRef.update(e.target.value)
    },
    [textRef],
  )

  if (multiline) {
    return (
      <textarea
        placeholder={placeholder}
        rows={4}
        value={value}
        onChange={handleChange}
      />
    )
  }

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
    />
  )
}

/**
 * CollaborativeTextarea - Uncontrolled textarea using useCollaborativeText.
 * Character-level operations preserve user intent during concurrent edits.
 */
function CollaborativeTextarea({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } =
    useCollaborativeText<HTMLTextAreaElement>(textRef)

  return (
    <textarea
      ref={inputRef}
      placeholder={placeholder}
      rows={4}
      defaultValue={defaultValue}
    />
  )
}

/**
 * CollaborativeInput - Uncontrolled input using useCollaborativeText.
 * Best for real-time collaboration where multiple users may type simultaneously.
 */
function CollaborativeInput({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } =
    useCollaborativeText<HTMLInputElement>(textRef)

  return (
    <input
      type="text"
      ref={inputRef}
      placeholder={placeholder}
      defaultValue={defaultValue}
    />
  )
}

// ============================================
// Settings Panel
// ============================================

function SettingsPanel({
  isOpen,
  textApproach,
  setTextApproach,
  networkDelay,
  setNetworkDelay,
}: {
  isOpen: boolean
  textApproach: TextApproach
  setTextApproach: (approach: TextApproach) => void
  networkDelay: number
  setNetworkDelay: (delay: number) => void
}) {
  return (
    <div className={`settings-panel ${isOpen ? "expanded" : "collapsed"}`}>
      <div className="settings-content">
        <h3 className="settings-title">Demo Settings</h3>

        <div className="setting-item">
          <span className="setting-label">Text Input Mode</span>
          <div className="approach-selector">
            <label>
              <input
                type="radio"
                name="approach"
                value="collaborative"
                checked={textApproach === "collaborative"}
                onChange={() => setTextApproach("collaborative")}
              />
              <span>
                <strong>Collaborative</strong> — Character-level merging
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="approach"
                value="last-write-wins"
                checked={textApproach === "last-write-wins"}
                onChange={() => setTextApproach("last-write-wins")}
              />
              <span>
                <strong>Last-write-wins</strong> — Simpler, controlled inputs
              </span>
            </label>
          </div>
        </div>

        <div className="setting-item">
          <span className="setting-label">
            Network Delay:{" "}
            {networkDelay === 0
              ? "Off"
              : `${(networkDelay / 1000).toFixed(1)}s`}
          </span>
          <input
            type="range"
            min="0"
            max="10000"
            step="500"
            value={networkDelay}
            onChange={e => setNetworkDelay(Number(e.target.value))}
            className="settings-slider"
          />
          <p className="setting-hint">
            Simulates network latency to demonstrate merge behavior
          </p>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Main App Component
// ============================================

// Type alias for settings snapshot
type SettingsSnapshot = Infer<typeof SettingsSchema>

function App() {
  // Get documents for mutations and reading
  const settingsDoc = useDocument(SETTINGS_DOC_ID, SettingsSchema)
  const formDoc = useDocument(FORM_DOC_ID, FormSchema)

  // Cast to help TypeScript infer the schema type
  const {
    settings: {
      textApproach: textApproachValue,
      networkDelay: networkDelayValue,
    },
  } = useValue(settingsDoc) as SettingsSnapshot

  const { undo, redo, canUndo, canRedo } = useUndoManager(formDoc)

  // Settings state
  const [settingsOpen, setSettingsOpen] = useState(false)

  const textApproach: TextApproach =
    textApproachValue === "last-write-wins" ||
    textApproachValue === "collaborative"
      ? textApproachValue
      : "collaborative"

  const setTextApproach = (approach: TextApproach) => {
    settingsDoc.settings.textApproach = approach
  }

  const networkDelay = Math.max(0, Math.min(10000, networkDelayValue ?? 0))

  const setNetworkDelay = useCallback(
    (delay: number) => {
      const currentValue = networkDelayValue ?? 0
      const delta = delay - currentValue
      if (delta > 0) {
        settingsDoc.settings.networkDelay.increment(delta)
      } else if (delta < 0) {
        settingsDoc.settings.networkDelay.decrement(-delta)
      }
    },
    [settingsDoc.settings, networkDelayValue],
  )

  // Connection status
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")

  useEffect(() => {
    return wsAdapter.subscribe(setConnectionState)
  }, [])

  // Network delay interceptor
  useEffect(() => {
    if (networkDelay === 0) {
      wsAdapter.clearSendInterceptors()
      return
    }
    const unsubscribe = wsAdapter.addSendInterceptor((ctx, next) => {
      const docId = getDocIdFromMessage(ctx.envelope.message)
      if (docId === SETTINGS_DOC_ID) {
        next()
      } else {
        setTimeout(next, networkDelay)
      }
    })
    return unsubscribe
  }, [networkDelay])

  const renderTextInput = (textRef: TextRef, multiline = false) => {
    switch (textApproach) {
      case "last-write-wins":
        return <RefValueInput textRef={textRef} multiline={multiline} />
      case "collaborative":
        return multiline ? (
          <CollaborativeTextarea textRef={textRef} />
        ) : (
          <CollaborativeInput textRef={textRef} />
        )
    }
  }

  return (
    <>
      {/* Connection Status */}
      <ConnectionBar state={connectionState} />

      {/* Header */}
      <div className="header">
        <h1>Collaborative Form</h1>
        <div className="header-actions">
          <button
            type="button"
            className={`settings-toggle ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Settings Panel (collapsible) */}
      <SettingsPanel
        isOpen={settingsOpen}
        textApproach={textApproach}
        setTextApproach={setTextApproach}
        networkDelay={networkDelay}
        setNetworkDelay={setNetworkDelay}
      />

      {/* Main Form Card */}
      <div className="form-card">
        {/* Atomic Controls */}
        <div className="form-section">
          <div className="field">
            <span className="field-label">Status</span>
            <StatusDropdown statusRef={formDoc.status} />
          </div>

          <div className="field">
            <span className="field-label">Priority</span>
            <PrioritySelector priorityRef={formDoc.priority} />
          </div>
        </div>

        <div className="form-divider" />

        {/* Text Controls */}
        <div className="form-section">
          <div className="field">
            <span className="field-label">Title</span>
            {renderTextInput(formDoc.title)}
          </div>

          <div className="field">
            <span className="field-label">Description</span>
            {renderTextInput(formDoc.description, true)}
          </div>

          <div className="field">
            <span className="field-label">Notes</span>
            {renderTextInput(formDoc.notes, true)}
          </div>
        </div>

        {/* Form Footer with Undo/Redo */}
        <div className="form-footer">
          <button type="button" onClick={undo} disabled={!canUndo}>
            ⟲ Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo}>
            ⟳ Redo
          </button>
        </div>
      </div>

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

// Bootstrap
const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
