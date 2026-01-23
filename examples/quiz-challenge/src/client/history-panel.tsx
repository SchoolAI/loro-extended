import { loro } from "@loro-extended/change"
import type { Handle } from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"
import {
  getFrontierForEntry,
  getMessageHistory,
  type HistoryEntry,
} from "../shared/history.js"
import type { QuizDocSchema } from "../shared/schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - History Panel
// ═══════════════════════════════════════════════════════════════════════════
//
// A fly-out side panel that displays the state transition history.
// Each entry shows the message type and timestamp, with a "Restore" button
// to checkout the document to that historical state.
//
// Time Travel Pattern:
// - Uses checkout() to move the document to a historical frontier
// - The document becomes "detached" when viewing history
// - Use checkoutToLatest() to return to the live state

type Props = {
  handle: Handle<typeof QuizDocSchema>
  isOpen: boolean
  onClose: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Type Display Names
// ═══════════════════════════════════════════════════════════════════════════

const MESSAGE_LABELS: Record<string, string> = {
  START_QUIZ: "🚀 Started Quiz",
  SELECT_OPTION: "👆 Selected Option",
  SUBMIT_ANSWER: "📤 Submitted Answer",
  TIME_UP: "⏰ Time Up",
  RECEIVE_FEEDBACK: "💬 Received Feedback",
  NEXT_QUESTION: "➡️ Next Question",
  RESTART_QUIZ: "🔄 Restarted Quiz",
}

function getMessageLabel(type: string): string {
  return MESSAGE_LABELS[type] ?? type
}

// ═══════════════════════════════════════════════════════════════════════════
// Format Timestamp
// ═══════════════════════════════════════════════════════════════════════════

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// History Entry Component
// ═══════════════════════════════════════════════════════════════════════════

function HistoryEntryItem({
  entry,
  isSelected,
  onRestore,
}: {
  entry: HistoryEntry
  isSelected: boolean
  onRestore: () => void
}) {
  return (
    <div
      className={`history-entry ${isSelected ? "history-entry-selected" : ""}`}
    >
      <div className="history-entry-content">
        <div className="history-entry-type">
          {getMessageLabel(entry.msg.type)}
        </div>
        <div className="history-entry-time">{formatTime(entry.timestamp)}</div>
      </div>
      <button type="button" className="history-restore-btn" onClick={onRestore}>
        Restore
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// History Panel Component
// ═══════════════════════════════════════════════════════════════════════════

export function HistoryPanel({ handle, isOpen, onClose }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Track detached state to clear selection when returning to live
  useEffect(() => {
    if (!isOpen) return

    const checkDetached = () => {
      const isDetached = loro(handle.doc).doc.isDetached()
      // Clear selection when returning to live state
      if (!isDetached) {
        setSelectedId(null)
      }
    }

    return loro(handle.doc).subscribe(checkDetached)
  }, [handle, isOpen])

  // Refresh history when panel opens or doc changes
  useEffect(() => {
    if (!isOpen) return

    const refresh = () => {
      // Get history from the oplog (not affected by checkout)
      const oplogFrontiers = loro(handle.doc).doc.oplogFrontiers()
      setHistory(getMessageHistory(handle.doc, oplogFrontiers))
    }

    refresh()
    const unsub = loro(handle.doc).subscribe(refresh)
    return unsub
  }, [handle, isOpen])

  const handleRestore = useCallback(
    (entry: HistoryEntry) => {
      const frontier = getFrontierForEntry(entry)
      
      // Checkout moves the document to the historical state
      // The document becomes "detached" - viewing history
      handle.loroDoc.checkout(frontier)
    },
    [handle],
  )

  if (!isOpen) return null

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <h3>📜 State History</h3>
        <button
          type="button"
          className="history-close-btn"
          onClick={onClose}
          aria-label="Close history panel"
        >
          ×
        </button>
      </div>

      <div className="history-panel-content">
        {history.length === 0 ? (
          <div className="history-empty">
            <p>No state transitions yet.</p>
            <p className="history-empty-hint">
              Start the quiz to see history entries appear here.
            </p>
          </div>
        ) : (
          <div className="history-list">
            {history.map(entry => (
              <HistoryEntryItem
                key={entry.id}
                entry={entry}
                isSelected={selectedId === entry.id}
                onRestore={() => {
                  setSelectedId(entry.id)
                  handleRestore(entry)
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="history-panel-footer">
        <p className="history-footer-hint">
          Click "Restore" to view the app at that point in time.
        </p>
      </div>
    </div>
  )
}
