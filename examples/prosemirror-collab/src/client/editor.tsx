/**
 * ProseMirror Editor Component
 *
 * Wraps loro-prosemirror's editor with loro-extended integration.
 *
 * This demonstrates the elegant external store integration pattern:
 * - Document uses Shape.any() (loro-prosemirror manages its structure)
 * - Cursor store is loro-prosemirror's CursorEphemeralStore
 * - Network sync is automatic via sync(doc).addEphemeral()
 *
 * No bridge code needed! The CursorEphemeralStore extends EphemeralStore,
 * so when loro-prosemirror calls store.set(), the Synchronizer automatically
 * broadcasts to peers. When network data arrives, store.apply() is called
 * and loro-prosemirror sees the update.
 */

import { type Doc, sync } from "@loro-extended/repo"
import type { PeerID } from "loro-crdt"
import {
  CursorEphemeralStore,
  type LoroDocType,
  LoroEphemeralCursorPlugin,
  LoroSyncPlugin,
  LoroUndoPlugin,
  redo,
  undo,
} from "loro-prosemirror"
import { exampleSetup } from "prosemirror-example-setup"
import { keymap } from "prosemirror-keymap"
import { DOMParser, Schema } from "prosemirror-model"
import { schema } from "prosemirror-schema-basic"
import { addListNodes } from "prosemirror-schema-list"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { useEffect, useMemo, useRef } from "react"
import type { ProseMirrorDocShape } from "../shared/schemas.js"
import { getUserColor } from "./repo-provider.js"

// Create the ProseMirror schema with list support
const mySchema = new Schema({
  nodes: addListNodes(schema.spec.nodes, "paragraph block*", "block"),
  marks: schema.spec.marks,
})

// Create an empty document for initialization
const emptyDoc = DOMParser.fromSchema(mySchema).parse(
  document.createElement("div"),
)

// Get base plugins from prosemirror-example-setup (without history - we use Loro's)
const basePlugins = exampleSetup({
  schema: mySchema,
  history: false,
})

interface EditorProps {
  /**
   * The document.
   * Document is untyped (Shape.any()) - loro-prosemirror manages its structure.
   * Cursor sync uses sync(doc).addEphemeral() for automatic network sync.
   */
  doc: Doc<ProseMirrorDocShape>

  /**
   * The user's display name for cursor labels.
   */
  userName: string
}

/**
 * Collaborative ProseMirror editor component.
 *
 * Integrates:
 * - LoroSyncPlugin for document sync
 * - LoroUndoPlugin for collaborative undo/redo
 * - LoroEphemeralCursorPlugin for cursor presence (via addEphemeral)
 */
export function Editor({ doc, userName }: EditorProps) {
  const editorRef = useRef<EditorView | null>(null)
  const editorDomRef = useRef<HTMLDivElement>(null)
  const cursorStoreRef = useRef<CursorEphemeralStore | null>(null)

  // Get sync ref for accessing peerId and addEphemeral
  const syncRef = sync(doc)
  const peerId = syncRef.peerId

  // Get user color based on peerId
  const userColor = useMemo(() => getUserColor(peerId), [peerId])

  // Initialize the editor
  useEffect(() => {
    if (editorRef.current || !editorDomRef.current) return

    // Access the raw LoroDoc - this is the escape hatch for Shape.any()
    const loroDoc = syncRef.loroDoc

    // Get the container ID for the "doc" map - this is where ProseMirror stores its content
    const containerId = loroDoc.getMap("doc").id

    // Create loro-prosemirror's cursor store
    const cursorStore = new CursorEphemeralStore(peerId as PeerID)
    cursorStoreRef.current = cursorStore

    // Register it for network sync - ONE LINE!
    // The Synchronizer automatically:
    // - Subscribes to store changes (by='local' triggers broadcast)
    // - Applies incoming network data (by='import' updates the store)
    syncRef.addEphemeral("cursors", cursorStore)

    // Build plugins array
    // Note: We cast loroDoc to LoroDocType because loro-prosemirror expects
    // a specific type, but the underlying LoroDoc is compatible at runtime.
    const plugins = [
      ...basePlugins,
      LoroSyncPlugin({
        doc: loroDoc as LoroDocType,
        containerId,
      }),
      LoroUndoPlugin({
        doc: loroDoc as LoroDocType,
      }),
      keymap({
        "Mod-z": state => undo(state, () => {}),
        "Mod-y": state => redo(state, () => {}),
        "Mod-Shift-z": state => redo(state, () => {}),
      }),
      LoroEphemeralCursorPlugin(cursorStore, {
        user: {
          name: userName,
          color: userColor,
        },
      }),
    ]

    // Create the editor
    editorRef.current = new EditorView(editorDomRef.current, {
      state: EditorState.create({
        doc: emptyDoc,
        plugins,
      }),
    })

    // Cleanup on unmount
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
      }
      cursorStoreRef.current = null
    }
  }, [syncRef, peerId, userName, userColor])

  return (
    <div className="editor-container">
      <div ref={editorDomRef} className="editor" />
    </div>
  )
}
