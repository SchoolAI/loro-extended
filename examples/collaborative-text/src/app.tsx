import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import {
  RepoProvider,
  Shape,
  type TextRef,
  useCollaborativeText,
  useDoc,
  useHandle,
  useUndoManager,
} from "@loro-extended/react"
import { useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

// Schema - defines the shape of our collaborative document
const TextSchema = Shape.doc({
  // Single-line input field
  title: Shape.text().placeholder("Untitled Document"),
  // Multi-line textarea
  description: Shape.text().placeholder(""),
  // Another text field for notes
  notes: Shape.text(),
})

// ============================================
// Approach 1: Simple Controlled Inputs
// ============================================
// This approach uses controlled inputs with useDoc.
// Pros: Simple, familiar React pattern
// Cons: Replaces entire text on each keystroke (less efficient for CRDT)

function SimpleControlledInput({
  textRef,
  value,
  placeholder,
  multiline = false,
}: {
  textRef: TextRef
  value: string
  placeholder?: string
  multiline?: boolean
}) {
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
// Approach 2: useCollaborativeText Hook
// ============================================
// This approach uses the useCollaborativeText hook for fine-grained CRDT operations.
// Pros: Efficient character-by-character operations, better for concurrent editing
// Cons: More complex, uses uncontrolled inputs

function CollaborativeTextarea({
  textRef,
  placeholder,
}: {
  textRef: TextRef
  placeholder?: string
}) {
  // The hook uses a ref callback pattern for proper initialization:
  // - Syncs input value FROM the CRDT when element mounts
  // - Attaches native event listeners immediately
  // - Validates selection bounds before CRDT operations
  const { inputRef, defaultValue } =
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

function CollaborativeInput({
  textRef,
  placeholder,
}: {
  textRef: TextRef
  placeholder?: string
}) {
  const { inputRef, defaultValue } =
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

function App() {
  const handle = useHandle("shared-text", TextSchema)
  const { title, description, notes } = useDoc(handle)
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle)

  // Toggle between approaches for demonstration
  const [useHook, setUseHook] = useState(true)

  return (
    <div className="container">
      <h1>Collaborative Text Inputs</h1>

      <div className="toolbar">
        <button type="button" onClick={undo} disabled={!canUndo}>
          ⟲ Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo}>
          ⟳ Redo
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={useHook}
            onChange={e => setUseHook(e.target.checked)}
          />
          <span>Use useCollaborativeText hook</span>
        </label>
      </div>

      <div className="field">
        <span className="field-label">Title (single line)</span>
        {useHook ? (
          <CollaborativeInput
            textRef={handle.doc.title}
            placeholder="Enter a title..."
          />
        ) : (
          <SimpleControlledInput
            textRef={handle.doc.title}
            value={title}
            placeholder="Enter a title..."
          />
        )}
        <div className="preview">
          <strong>Current value:</strong> {title || "(empty)"}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Description (multi-line)</span>
        {useHook ? (
          <CollaborativeTextarea
            textRef={handle.doc.description}
            placeholder="Enter a description..."
          />
        ) : (
          <SimpleControlledInput
            textRef={handle.doc.description}
            value={description}
            placeholder="Enter a description..."
            multiline
          />
        )}
        <div className="preview">
          <strong>Current value:</strong>
          <pre>{description || "(empty)"}</pre>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Notes</span>
        {useHook ? (
          <CollaborativeTextarea
            textRef={handle.doc.notes}
            placeholder="Add some notes..."
          />
        ) : (
          <SimpleControlledInput
            textRef={handle.doc.notes}
            value={notes}
            placeholder="Add some notes..."
            multiline
          />
        )}
        <div className="preview">
          <strong>Current value:</strong>
          <pre>{notes || "(empty)"}</pre>
        </div>
      </div>

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
          <strong>Toggle the checkbox</strong> to switch between the simple
          controlled approach and the useCollaborativeText hook.
        </p>
      </div>
    </div>
  )
}

// Bootstrap - connect to WebSocket and render
const wsAdapter = new WsClientNetworkAdapter({
  url: `ws://${location.host}/ws`,
})

const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <RepoProvider config={{ adapters: [wsAdapter] }}>
      <App />
    </RepoProvider>,
  )
}
