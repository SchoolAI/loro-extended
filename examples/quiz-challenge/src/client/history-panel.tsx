import { loro } from "@loro-extended/change"
import type { Handle } from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"
import {
  getMessageHistory,
  getMessageHistoryFromHistoryDoc,
  type HistoryEntry,
} from "../shared/history.js"
import type { HistoryDocSchema } from "../shared/history-schema.js"
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
//
// Separate History Document Pattern:
// - The history panel subscribes to a SEPARATE history document
// - This document is NEVER checked out, ensuring subscriptions always fire
// - The app document can be freely checked out for time travel

type Props = {
  appHandle: Handle<typeof QuizDocSchema>
  historyHandle: Handle<typeof HistoryDocSchema>
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
  canRestore,
  onRestore,
}: {
  entry: HistoryEntry
  isSelected: boolean
  canRestore: boolean
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
      {canRestore && (
        <button
          type="button"
          className="history-restore-btn"
          onClick={onRestore}
        >
          Restore
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// History Panel Component
// ═══════════════════════════════════════════════════════════════════════════

export function HistoryPanel({
  appHandle,
  historyHandle,
  isOpen,
  onClose,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // History entries from the separate history document
  // This document is NEVER checked out, ensuring subscriptions always fire
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])

  // Also get entries from the app document's oplog for restore functionality
  // These have frontier information needed for checkout
  const [appHistoryEntries, setAppHistoryEntries] = useState<HistoryEntry[]>([])

  // Subscribe to history document for real-time updates
  // This document is NEVER checked out, so subscriptions always fire
  useEffect(() => {
    if (!isOpen) return

    const refresh = () => {
      setHistoryEntries(getMessageHistoryFromHistoryDoc(historyHandle.doc))
    }

    refresh()
    const unsub = loro(historyHandle.doc).subscribe(refresh)
    return unsub
  }, [historyHandle, isOpen])

  // Track detached state to clear selection when returning to live
  useEffect(() => {
    if (!isOpen) return

    const checkDetached = () => {
      const isDetached = loro(appHandle.doc).doc.isDetached()
      // Clear selection when returning to live state
      if (!isDetached) {
        setSelectedId(null)
      }
    }

    return loro(appHandle.doc).subscribe(checkDetached)
  }, [appHandle, isOpen])

  // Refresh app history entries when panel opens or app doc changes
  // This is needed to get frontier information for restore functionality
  useEffect(() => {
    if (!isOpen) return

    const refresh = () => {
      // Get history from the oplog (not affected by checkout)
      const oplogFrontiers = loro(appHandle.doc).doc.oplogFrontiers()
      setAppHistoryEntries(getMessageHistory(appHandle.doc, oplogFrontiers))
    }

    refresh()
    const unsub = loro(appHandle.doc).subscribe(refresh)
    return unsub
  }, [appHandle, isOpen])

  // Find the corresponding app history entry for restore
  const findAppEntry = useCallback(
    (historyEntry: HistoryEntry): HistoryEntry | undefined => {
      // Match by timestamp and message type
      return appHistoryEntries.find(
        appEntry =>
          appEntry.msg.type === historyEntry.msg.type &&
          Math.abs(appEntry.timestamp - historyEntry.timestamp) < 1000,
      )
    },
    [appHistoryEntries],
  )

  const handleRestore = useCallback(
    (entry: HistoryEntry) => {
      // Find the corresponding app entry with frontier information
      const appEntry = findAppEntry(entry)
      if (appEntry?.frontier) {
        // Checkout moves the document to the historical state
        // The document becomes "detached" - viewing history
        appHandle.loroDoc.checkout(appEntry.frontier)
      }
    },
    [appHandle, findAppEntry],
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
        {historyEntries.length === 0 ? (
          <div className="history-empty">
            <p>No state transitions yet.</p>
            <p className="history-empty-hint">
              Start the quiz to see history entries appear here.
            </p>
          </div>
        ) : (
          <div className="history-list">
            {historyEntries.map(entry => {
              const appEntry = findAppEntry(entry)
              const canRestore = !!appEntry?.frontier
              return (
                <HistoryEntryItem
                  key={entry.id}
                  entry={entry}
                  isSelected={selectedId === entry.id}
                  canRestore={canRestore}
                  onRestore={() => {
                    setSelectedId(entry.id)
                    handleRestore(entry)
                  }}
                />
              )
            })}
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
