import { loro } from "@loro-extended/change"
import type { Handle } from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"
import { checkoutToFrontier } from "../shared/checkout-utils.js"
import {
  getMessageHistory,
  getMessageHistoryFromHistoryDoc,
  type HistoryEntry,
  type HistoryMessageEntry,
  INITIAL_STATE_ENTRY,
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

function getEntryLabel(entry: HistoryEntry): string {
  if (entry.kind === "initial") {
    return "🏁 Initial State"
  }
  return MESSAGE_LABELS[entry.msg.type] ?? entry.msg.type
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
        <div className="history-entry-type">{getEntryLabel(entry)}</div>
        <div className="history-entry-time">
          {entry.kind === "initial" ? "—" : formatTime(entry.timestamp)}
        </div>
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

  // History entries from the separate history document (message entries only)
  // This document is NEVER checked out, ensuring subscriptions always fire
  const [historyEntries, setHistoryEntries] = useState<HistoryMessageEntry[]>(
    [],
  )

  // Also get entries from the app document's oplog for restore functionality
  // These have frontier information needed for checkout
  const [appHistoryEntries, setAppHistoryEntries] = useState<
    HistoryMessageEntry[]
  >([])

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

  // Find the corresponding app history entry for restore (message entries only)
  const findAppEntry = useCallback(
    (historyEntry: HistoryMessageEntry): HistoryMessageEntry | undefined => {
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
      // Initial state uses empty frontier directly
      if (entry.kind === "initial") {
        checkoutToFrontier(appHandle.loroDoc, entry.frontier)
        return
      }
      // Find the corresponding app entry with frontier information
      const appEntry = findAppEntry(entry)
      if (appEntry?.frontier) {
        // Use checkoutToFrontier to properly handle latest vs historical
        // - If latest: calls checkoutToLatest() to re-attach
        // - If historical: calls checkout() to detach
        checkoutToFrontier(appHandle.loroDoc, appEntry.frontier)
      }
    },
    [appHandle, findAppEntry],
  )

  // Combine initial state entry with message entries for display
  const allEntries: HistoryEntry[] = [INITIAL_STATE_ENTRY, ...historyEntries]

  if (!isOpen) return null

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <h3>⏱️ Time Travel</h3>
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
        <div className="history-list">
          {allEntries.map(entry => {
            // Initial state always has a frontier (empty array)
            // Message entries need to find the corresponding app entry
            const canRestore =
              entry.kind === "initial" || !!findAppEntry(entry)?.frontier
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
      </div>

      <div className="history-panel-footer">
        <p className="history-footer-hint">
          Click "Restore" to view the app at that point in time.
        </p>
      </div>
    </div>
  )
}
