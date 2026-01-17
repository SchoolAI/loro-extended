import { createWsClient } from "@loro-extended/adapter-websocket/client"
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
import { useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

// Schema - defines the shape of our collaborative document
const FormSchema = Shape.doc({
  // ============================================
  // Atomic Controls - useRefValue is the natural choice
  // These have discrete values where "last-write-wins" is intuitive
  // ============================================
  status: Shape.text().placeholder("draft"), // Dropdown selection
  priority: Shape.counter().placeholder(2), // Numeric priority (1-5)

  // ============================================
  // Text Controls - choice depends on collaboration pattern
  // ============================================
  title: Shape.text().placeholder("Untitled Document"), // Short text
  description: Shape.text().placeholder("Enter a description..."), // Long text
  notes: Shape.text().placeholder("Add some notes..."), // Long text
})

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
  const displayValue = Math.max(1, Math.min(5, value))

  return (
    <div className="priority-selector">
      <button
        type="button"
        onClick={() => priorityRef.decrement(1)}
        disabled={displayValue <= 1}
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

  return (
    <textarea
      ref={inputRef}
      placeholder={placeholder}
      rows={4}
      defaultValue={defaultValue}
    />
  )
}

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
// Main App Component
// ============================================

type TextApproach = "useRefValue" | "useCollaborativeText"

function App() {
  const handle = useHandle("shared-form", FormSchema)
  const { status, priority, title, description, notes } = useDoc(handle)
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle)

  // Select between approaches for text controls only
  const [textApproach, setTextApproach] = useState<TextApproach>("useRefValue")

  const renderTextInput = (textRef: TextRef, multiline = false) => {
    switch (textApproach) {
      case "useRefValue":
        return <RefValueInput textRef={textRef} multiline={multiline} />
      case "useCollaborativeText":
        return multiline ? (
          <CollaborativeTextarea textRef={textRef} />
        ) : (
          <CollaborativeInput textRef={textRef} />
        )
    }
  }

  return (
    <div className="container">
      <h1>Collaborative Form</h1>

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
          <StatusDropdown statusRef={handle.doc.status} />
          <div className="preview">
            <strong>Current value:</strong> {status || "draft"}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Priority</span>
          <PrioritySelector priorityRef={handle.doc.priority} />
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
          For text inputs, the choice depends on your collaboration pattern.
          Switch between approaches to compare:
        </p>

        <div className="approach-selector">
          <label>
            <input
              type="radio"
              name="approach"
              value="useRefValue"
              checked={textApproach === "useRefValue"}
              onChange={e => setTextApproach(e.target.value as TextApproach)}
            />
            <strong>useRefValue</strong> - Controlled inputs, simpler code. Best
            when concurrent editing is rare.
          </label>
          <label>
            <input
              type="radio"
              name="approach"
              value="useCollaborativeText"
              checked={textApproach === "useCollaborativeText"}
              onChange={e => setTextApproach(e.target.value as TextApproach)}
            />
            <strong>useCollaborativeText</strong> - Character-level operations.
            Best for real-time collaboration.
          </label>
        </div>

        <div className="field">
          <span className="field-label">Title (single line)</span>
          {renderTextInput(handle.doc.title)}
          <div className="preview">
            <strong>Current value:</strong> {title || "(empty)"}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Description (multi-line)</span>
          {renderTextInput(handle.doc.description, true)}
          <div className="preview">
            <strong>Current value:</strong>
            <pre>{description || "(empty)"}</pre>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Notes</span>
          {renderTextInput(handle.doc.notes, true)}
          <div className="preview">
            <strong>Current value:</strong>
            <pre>{notes || "(empty)"}</pre>
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

// Bootstrap - connect to WebSocket and render
const wsAdapter = createWsClient({
  url: `ws://${location.host}/ws`,
  reconnect: { enabled: true },
})

const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
