import {
  type ConnectionState,
  createWsClient,
} from "@loro-extended/adapter-websocket/client"
import { loro } from "@loro-extended/change"
import {
  type CounterRef,
  RepoProvider,
  Shape,
  type TextRef,
  useCollaborativeText,
  useDoc,
  useHandle,
  useRefValue,
  useUndoManager,
} from "@loro-extended/react"
import type { Cursor, LoroText } from "loro-crdt"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
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

// Form schema - synced with configurable delay
const FormSchema = Shape.doc({
  // ============================================
  // Atomic Controls - useRefValue is the natural choice
  // These have discrete values where "last-write-wins" is intuitive
  // ============================================
  status: Shape.text().placeholder("draft"), // Dropdown selection
  priority: Shape.counter(), // Numeric priority (0-5)

  // ============================================
  // Text Controls - choice depends on collaboration pattern
  // ============================================
  title: Shape.text().placeholder("Untitled Document"), // Short text
  description: Shape.text().placeholder("Enter a description..."), // Long text
  notes: Shape.text().placeholder("Add some notes..."), // Long text
})

/**
 * Helper to extract docId from a channel message.
 * Returns undefined for messages without docId (like establish-request/response).
 */
function getDocIdFromMessage(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined
  const msg = message as Record<string, unknown>

  // Direct docId field (sync-request, sync-response, update, ephemeral, etc.)
  if ("docId" in msg && typeof msg.docId === "string") {
    return msg.docId
  }

  // Batch messages - check first message for docId
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
// Cursor Context for Undo/Redo Restoration
// ============================================
// This context tracks the currently focused text input and its TextRef
// so that useUndoManager can capture and restore cursor positions.

interface FocusedInput {
  element: HTMLInputElement | HTMLTextAreaElement
  textRef: TextRef
}

interface CursorContextValue {
  registerFocus: (
    element: HTMLInputElement | HTMLTextAreaElement,
    textRef: TextRef,
  ) => void
  unregisterFocus: (element: HTMLInputElement | HTMLTextAreaElement) => void
  getCursors: () => Cursor[]
  setCursors: (positions: Array<{ offset: number; side: -1 | 0 | 1 }>) => void
}

const CursorContext = createContext<CursorContextValue | null>(null)

function CursorProvider({ children }: { children: React.ReactNode }) {
  const focusedRef = useRef<FocusedInput | null>(null)

  const registerFocus = useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement, textRef: TextRef) => {
      focusedRef.current = { element, textRef }
    },
    [],
  )

  const unregisterFocus = useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement) => {
      if (focusedRef.current?.element === element) {
        focusedRef.current = null
      }
    },
    [],
  )

  const getCursors = useCallback((): Cursor[] => {
    const focused = focusedRef.current
    if (!focused) return []

    const { element, textRef } = focused
    const pos = element.selectionStart ?? 0
    const loroText = loro(textRef).container as LoroText
    const cursor = loroText.getCursor(pos)
    return cursor ? [cursor] : []
  }, [])

  const setCursors = useCallback(
    (positions: Array<{ offset: number; side: -1 | 0 | 1 }>) => {
      const focused = focusedRef.current
      if (!focused || positions.length === 0) return

      const { element } = focused
      const pos = positions[0].offset
      // Use requestAnimationFrame to ensure the DOM has updated
      requestAnimationFrame(() => {
        element.setSelectionRange(pos, pos)
        element.focus()
      })
    },
    [],
  )

  const value = useMemo(
    () => ({ registerFocus, unregisterFocus, getCursors, setCursors }),
    [registerFocus, unregisterFocus, getCursors, setCursors],
  )

  return (
    <CursorContext.Provider value={value}>{children}</CursorContext.Provider>
  )
}

function useCursorContext() {
  const context = useContext(CursorContext)
  if (!context) {
    throw new Error("useCursorContext must be used within CursorProvider")
  }
  return context
}

// ============================================
// Atomic Controls - Always use useRefValue
// ============================================
// These controls have discrete/atomic values where "last-write-wins"
// is the intuitive and expected behavior during concurrent edits.

/**
 * Status Dropdown - demonstrates useRefValue for atomic selection.
 *
 * Why useRefValue? A dropdown selection is atomic - there's no meaningful
 * "merge" of two different selections. If User A selects "review" and
 * User B selects "published" during a network partition, one must win.
 * This is exactly what users expect from a dropdown.
 */
function StatusDropdown({ statusRef }: { statusRef: TextRef }) {
  const { value } = useRefValue(statusRef)

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
 * Priority Selector - demonstrates useRefValue with CounterRef.
 *
 * Why useRefValue with CounterRef? Priority is a numeric value where
 * concurrent increments/decrements merge naturally via CRDT semantics.
 * However, the UI still shows a single value - there's no "partial" priority.
 */
function PrioritySelector({ priorityRef }: { priorityRef: CounterRef }) {
  // CounterRef.toJSON() returns number
  const { value } = useRefValue(priorityRef) as { value: number }
  // Clamp to valid range for display
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
// Text Controls - useRefValue (Controlled)
// ============================================
// This approach uses useRefValue for controlled inputs with automatic value/placeholder.
// Best for: Single-user sync, form fields, settings - where concurrent editing is rare.
// Tradeoff: Replaces entire text on each keystroke, which can produce unexpected
// merges during concurrent editing (e.g., "Hello World" + "Hello There" → "Hello World There")

function RefValueInput({
  textRef,
  multiline = false,
}: {
  textRef: TextRef
  multiline?: boolean
}) {
  const { value, placeholder } = useRefValue(textRef)

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

// ============================================
// Text Controls - useCollaborativeText (Uncontrolled)
// ============================================
// This approach uses the useCollaborativeText hook for fine-grained CRDT operations.
// Best for: Real-time collaboration, document editing - where concurrent editing is expected.
// Benefit: Character-level operations preserve user intent during merges.

function CollaborativeTextarea({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } =
    useCollaborativeText<HTMLTextAreaElement>(textRef)
  const { registerFocus, unregisterFocus } = useCursorContext()
  const elementRef = useRef<HTMLTextAreaElement | null>(null)

  // Combine refs and register focus tracking
  const combinedRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      elementRef.current = element
      inputRef(element)

      if (element) {
        const handleFocus = () => registerFocus(element, textRef)
        const handleBlur = () => unregisterFocus(element)

        element.addEventListener("focus", handleFocus)
        element.addEventListener("blur", handleBlur)

        // Check if already focused
        if (document.activeElement === element) {
          registerFocus(element, textRef)
        }

        return () => {
          element.removeEventListener("focus", handleFocus)
          element.removeEventListener("blur", handleBlur)
        }
      }
    },
    [inputRef, registerFocus, unregisterFocus, textRef],
  )

  return (
    <textarea
      ref={combinedRef}
      placeholder={placeholder}
      rows={4}
      defaultValue={defaultValue}
    />
  )
}

function CollaborativeInput({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } =
    useCollaborativeText<HTMLInputElement>(textRef)
  const { registerFocus, unregisterFocus } = useCursorContext()
  const elementRef = useRef<HTMLInputElement | null>(null)

  // Combine refs and register focus tracking
  const combinedRef = useCallback(
    (element: HTMLInputElement | null) => {
      elementRef.current = element
      inputRef(element)

      if (element) {
        const handleFocus = () => registerFocus(element, textRef)
        const handleBlur = () => unregisterFocus(element)

        element.addEventListener("focus", handleFocus)
        element.addEventListener("blur", handleBlur)

        // Check if already focused
        if (document.activeElement === element) {
          registerFocus(element, textRef)
        }

        return () => {
          element.removeEventListener("focus", handleFocus)
          element.removeEventListener("blur", handleBlur)
        }
      }
    },
    [inputRef, registerFocus, unregisterFocus, textRef],
  )

  return (
    <input
      type="text"
      ref={combinedRef}
      placeholder={placeholder}
      defaultValue={defaultValue}
    />
  )
}

// ============================================
// Main App Component
// ============================================

function App() {
  // Two separate handles: settings (instant sync) and form (delayed sync)
  const settingsHandle = useHandle(SETTINGS_DOC_ID, SettingsSchema)
  const formHandle = useHandle(FORM_DOC_ID, FormSchema)

  // Subscribe to both documents
  const {
    settings: {
      textApproach: textApproachValue,
      networkDelay: networkDelayValue,
    },
  } = useDoc(settingsHandle)
  const { status, priority, title, description, notes } = useDoc(formHandle)

  const { getCursors, setCursors } = useCursorContext()

  // Use cursor-aware undo/redo (only for form, not settings)
  const { undo, redo, canUndo, canRedo } = useUndoManager(formHandle, {
    getCursors,
    setCursors,
  })

  // Shared text approach setting - synced instantly across all clients
  // Default to "useCollaborativeText" if not set
  const textApproach: TextApproach =
    textApproachValue === "last-write-wins" ||
    textApproachValue === "collaborative"
      ? textApproachValue
      : "collaborative"

  const setTextApproach = (approach: TextApproach) => {
    settingsHandle.doc.settings.textApproach = approach
  }

  // Network delay from shared settings (0-10000ms, default 3000ms)
  // Clamp to valid range
  const networkDelay = Math.max(0, Math.min(10000, networkDelayValue ?? 3000))

  const setNetworkDelay = useCallback(
    (delay: number) => {
      // Counter uses increment/decrement, so we need to calculate the delta
      const currentValue = networkDelayValue ?? 3000
      const delta = delay - currentValue
      if (delta > 0) {
        settingsHandle.doc.settings.networkDelay.increment(delta)
      } else if (delta < 0) {
        settingsHandle.doc.settings.networkDelay.decrement(-delta)
      }
    },
    [settingsHandle.doc.settings, networkDelayValue],
  )

  // Connection status from WebSocket adapter
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")

  // Subscribe to connection state changes
  useEffect(() => {
    return wsAdapter.subscribe(setConnectionState)
  }, [])

  // Manage send interceptor lifecycle based on delay setting
  // Settings document syncs instantly, form document is delayed
  useEffect(() => {
    if (networkDelay === 0) {
      wsAdapter.clearSendInterceptors()
      return
    }
    const unsubscribe = wsAdapter.addSendInterceptor((ctx, next) => {
      // Check if this message is for the settings document
      const docId = getDocIdFromMessage(ctx.envelope.message)
      if (docId === SETTINGS_DOC_ID) {
        // Settings sync instantly - no delay
        next()
      } else {
        // All other messages are delayed
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
    <div className="container">
      <div className="header">
        <h1>Collaborative Form</h1>
        <div className={`connection-status connection-${connectionState}`}>
          <span className="connection-dot" />
          <span className="connection-label">
            {connectionState === "connected"
              ? "Connected"
              : connectionState === "connecting"
                ? "Connecting..."
                : connectionState === "reconnecting"
                  ? "Reconnecting..."
                  : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="toolbar">
        <button type="button" onClick={undo} disabled={!canUndo}>
          ⟲ Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo}>
          ⟳ Redo
        </button>
      </div>

      {/* ============================================ */}
      {/* Atomic Controls Section */}
      {/* ============================================ */}
      <section className="section">
        <h2>Atomic Controls</h2>
        <p className="section-description">
          These controls always use <code>useRefValue</code> because their
          values are discrete/atomic. "Last-write-wins" is the intuitive
          behavior for dropdowns, checkboxes, and counters.
        </p>

        <div className="field">
          <span className="field-label">Status</span>
          <StatusDropdown statusRef={formHandle.doc.status} />
          <div className="preview">
            <strong>Current value:</strong> {status || "draft"}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Priority</span>
          <PrioritySelector priorityRef={formHandle.doc.priority} />
          <div className="preview">
            <strong>Current value:</strong> {priority}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* Text Controls Section */}
      {/* ============================================ */}
      <section className="section">
        <h2>Text Controls</h2>
        <p className="section-description">
          Text inputs using <code>{textApproach}</code>. Change the approach in
          Demo Settings below.
        </p>

        <div className="field">
          <span className="field-label">Title (single line)</span>
          {renderTextInput(formHandle.doc.title)}
          <div className="preview">
            <strong>Current value:</strong> {title || "(empty)"}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Description (multi-line)</span>
          {renderTextInput(formHandle.doc.description, true)}
          <div className="preview">
            <strong>Current value:</strong>
            <pre>{description || "(empty)"}</pre>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Notes</span>
          {renderTextInput(formHandle.doc.notes, true)}
          <div className="preview">
            <strong>Current value:</strong>
            <pre>{notes || "(empty)"}</pre>
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* Demo Settings Section */}
      {/* ============================================ */}
      <section className="section settings-section">
        <h2>⚙️ Demo Settings</h2>
        <p className="section-description">
          These settings are <strong>shared across all clients</strong> and sync
          instantly (bypassing the network delay). Try changing them in one tab
          and watch the other tabs update!
        </p>

        <div className="settings-grid">
          <div className="setting-item">
            <span className="setting-label">Text Input Approach</span>
            <div className="approach-selector">
              <label>
                <input
                  type="radio"
                  name="approach"
                  value="useRefValue"
                  checked={textApproach === "last-write-wins"}
                  onChange={() => setTextApproach("last-write-wins")}
                />
                <strong>useRefValue</strong> - Controlled inputs, simpler code
              </label>
              <label>
                <input
                  type="radio"
                  name="approach"
                  value="useCollaborativeText"
                  checked={textApproach === "collaborative"}
                  onChange={() => setTextApproach("collaborative")}
                />
                <strong>useCollaborativeText</strong> - Character-level
                operations
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
              id="network-delay"
              type="range"
              min="0"
              max="10000"
              step="500"
              value={networkDelay}
              onChange={e => setNetworkDelay(Number(e.target.value))}
              className="delay-slider settings-slider"
            />
            <p className="setting-hint">
              Simulates network latency for form data. Settings always sync
              instantly.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* Help Section */}
      {/* ============================================ */}
      <div className="hint">
        <p>
          <strong>Open this page in another tab</strong> to see real-time
          collaboration!
        </p>
        <p>
          <strong>Keyboard shortcuts:</strong> Ctrl/Cmd+Z to undo, Ctrl/Cmd+Y or
          Ctrl/Cmd+Shift+Z to redo
        </p>
        <p>
          <strong>Cursor restoration:</strong> When using{" "}
          <code>useCollaborativeText</code>, undo/redo will restore your cursor
          position!
        </p>

        <h3>Choosing the Right Approach</h3>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Control Type</th>
              <th>Hook</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Dropdown, Checkbox, Radio</td>
              <td>
                <code>useRefValue</code>
              </td>
              <td>Atomic values - last-write-wins is intuitive</td>
            </tr>
            <tr>
              <td>Counter, Slider</td>
              <td>
                <code>useRefValue</code>
              </td>
              <td>CRDT counter handles concurrent increments</td>
            </tr>
            <tr>
              <td>Text (rarely concurrent)</td>
              <td>
                <code>useRefValue</code>
              </td>
              <td>Simpler, controlled inputs work fine</td>
            </tr>
            <tr>
              <td>Text (concurrent editing)</td>
              <td>
                <code>useCollaborativeText</code>
              </td>
              <td>Character-level merge preserves all edits</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Bootstrap - render the app with CursorProvider
const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <CursorProvider>
        <App />
      </CursorProvider>
    </RepoProvider>,
  )
}
