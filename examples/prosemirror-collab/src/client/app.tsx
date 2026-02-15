/**
 * Main App Component
 *
 * Handles:
 * - Document ID routing via URL hash (#docId)
 * - User name management
 * - Connection status display
 * - Editor rendering
 *
 * This example demonstrates integrating loro-extended with loro-prosemirror:
 * - Document uses Shape.any() because loro-prosemirror manages its structure
 * - Cursor sync uses sync(doc).addEphemeral() for automatic network sync
 *
 * No typed presence schema needed! The CursorEphemeralStore from loro-prosemirror
 * is registered directly via sync(doc).addEphemeral() in the Editor component.
 */

import { useRepo } from "@loro-extended/react"
import { sync } from "@loro-extended/repo"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ProseMirrorDocSchema } from "../shared/schemas.js"
import { Editor } from "./editor.js"
import {
  getOrCreateUserName,
  getUserColor,
  saveUserName,
  wsAdapter,
} from "./repo-provider.js"

/**
 * Get or create a document ID from the URL hash.
 */
function getDocIdFromHash(): string {
  const hash = window.location.hash.slice(1) // Remove '#'
  if (!hash) {
    const newDocId = `doc-${crypto.randomUUID().slice(0, 8)}`
    window.location.hash = newDocId
    return newDocId
  }
  return hash
}

/**
 * Connection status indicator component.
 */
function ConnectionStatus() {
  const [status, setStatus] = useState(wsAdapter.connectionState)

  useEffect(() => {
    return wsAdapter.subscribe(setStatus)
  }, [])

  const statusColors: Record<string, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500",
    reconnecting: "bg-yellow-500",
    disconnected: "bg-red-500",
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      <span className="text-sm text-gray-600 capitalize">{status}</span>
    </div>
  )
}

/**
 * User name editor component.
 */
function UserNameEditor({
  userName,
  onUserNameChange,
  peerId,
}: {
  userName: string
  onUserNameChange: (name: string) => void
  peerId: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(userName)
  const userColor = getUserColor(peerId)

  const handleSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed) {
      onUserNameChange(trimmed)
      saveUserName(trimmed)
    }
    setIsEditing(false)
  }, [editValue, onUserNameChange])

  if (isEditing) {
    return (
      <form
        onSubmit={e => {
          e.preventDefault()
          handleSubmit()
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          className="px-2 py-1 text-sm border rounded"
          placeholder="Your name"
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setEditValue(userName)
        setIsEditing(true)
      }}
      className="flex items-center gap-2 px-3 py-1 text-sm rounded hover:bg-gray-100"
      title="Click to edit your name"
    >
      <div
        className="w-3 h-3 rounded-full"
        style={{ backgroundColor: userColor }}
      />
      <span>{userName}</span>
    </button>
  )
}

/**
 * Share button component.
 */
function ShareButton({ docId }: { docId: string }) {
  const [copied, setCopied] = useState(false)

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#${docId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [docId])

  return (
    <button
      type="button"
      onClick={handleShare}
      className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
    >
      {copied ? "Copied!" : "Share"}
    </button>
  )
}

/**
 * Main App component.
 */
export function App() {
  const [docId] = useState(getDocIdFromHash)
  const [userName, setUserName] = useState(getOrCreateUserName)
  const repo = useRepo()

  // Get document with untyped structure (loro-prosemirror manages structure)
  // No ephemeral declarations needed - cursor store is added via sync(doc).addEphemeral()
  const doc = useMemo(
    () => repo.get(docId, ProseMirrorDocSchema),
    [repo, docId],
  )

  // Get peerId from sync ref
  const peerId = sync(doc).peerId

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      // Reload the page to get the new document
      window.location.reload()
    }
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-900">
              Collaborative Editor
            </h1>
            <span className="text-sm text-gray-500 font-mono">#{docId}</span>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus />
            <UserNameEditor
              userName={userName}
              onUserNameChange={setUserName}
              peerId={peerId}
            />
            <ShareButton docId={docId} />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto py-8 px-4">
        <Editor doc={doc} userName={userName} />

        {/* Instructions */}
        <div className="mt-8 p-4 bg-white rounded-lg border border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            How to collaborate
          </h2>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>
              • Click <strong>Share</strong> to copy the URL and send it to
              others
            </li>
            <li>• Click your name to change it</li>
            <li>• Your cursor and selection are visible to other users</li>
            <li>
              • Changes sync in real-time and persist even when you close the
              browser
            </li>
            <li>
              • Use{" "}
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                Cmd/Ctrl+Z
              </kbd>{" "}
              to undo,{" "}
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                Cmd/Ctrl+Y
              </kbd>{" "}
              or{" "}
              <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                Cmd/Ctrl+Shift+Z
              </kbd>{" "}
              to redo
            </li>
          </ul>
        </div>
      </main>
    </div>
  )
}
