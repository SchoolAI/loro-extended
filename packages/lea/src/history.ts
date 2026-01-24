import { type Infer, Shape, type TypedDoc } from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - History Document Schema and Utilities
// ═══════════════════════════════════════════════════════════════════════════
//
// The history document is a SEPARATE document from the app document.
// It stores a log of all dispatched messages for time travel debugging.
//
// Key insight: The history document is NEVER checked out. This ensures
// that subscriptions always fire when new entries arrive from peers,
// even when the app document is checked out to a historical state.

// ═══════════════════════════════════════════════════════════════════════════
// History Entry Schema
// ═══════════════════════════════════════════════════════════════════════════

export const HistoryEntrySchema = Shape.struct({
  /** Unique ID for this entry */
  id: Shape.plain.string(),
  /** The message type (e.g., "START_QUIZ", "SELECT_OPTION") */
  msgType: Shape.plain.string(),
  /** The full message as JSON string */
  msgJson: Shape.plain.string(),
  /** Timestamp when the message was dispatched */
  timestamp: Shape.plain.number(),
})

export type HistoryEntry = Infer<typeof HistoryEntrySchema>

// ═══════════════════════════════════════════════════════════════════════════
// History Document Schema
// ═══════════════════════════════════════════════════════════════════════════

export const HistoryDocSchema = Shape.doc({
  entries: Shape.list(HistoryEntrySchema),
})

export type HistoryDoc = Infer<typeof HistoryDocSchema>

// ═══════════════════════════════════════════════════════════════════════════
// History Document ID Utility
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a history document ID from an app document ID.
 *
 * Convention: history doc ID = app doc ID + ":history"
 *
 * @param appDocId The app document ID
 * @returns The history document ID
 *
 * @example
 * ```typescript
 * const historyDocId = getHistoryDocId("quiz-123")
 * // Returns: "quiz-123:history"
 * ```
 */
export function getHistoryDocId(appDocId: string): string {
  return `${appDocId}:history`
}

// ═══════════════════════════════════════════════════════════════════════════
// Append History Entry Utility
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append a history entry to the history document.
 *
 * @param historyDoc The history document
 * @param msg The message that was dispatched
 * @param timestamp The timestamp when the message was dispatched
 *
 * @example
 * ```typescript
 * appendHistoryEntry(historyDoc, { type: "START" }, Date.now())
 * ```
 */
export function appendHistoryEntry<Msg>(
  historyDoc: TypedDoc<typeof HistoryDocSchema>,
  msg: Msg,
  timestamp: number,
): void {
  historyDoc.change(draft => {
    draft.entries.push({
      id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
      msgType: (msg as { type?: string }).type ?? "unknown",
      msgJson: JSON.stringify(msg),
      timestamp,
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Get History Entries Utility
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsed history entry with the original message object.
 */
export type ParsedHistoryEntry<Msg> = {
  id: string
  msg: Msg
  timestamp: number
}

/**
 * Get all history entries from the history document.
 *
 * @param historyDoc The history document
 * @returns Array of parsed history entries
 *
 * @example
 * ```typescript
 * const entries = getHistoryEntries<MyMsg>(historyDoc)
 * for (const entry of entries) {
 *   console.log(entry.msg.type, entry.timestamp)
 * }
 * ```
 */
export function getHistoryEntries<Msg>(
  historyDoc: TypedDoc<typeof HistoryDocSchema>,
): ParsedHistoryEntry<Msg>[] {
  const entries = historyDoc.toJSON().entries
  return entries.map(entry => ({
    id: entry.id,
    msg: JSON.parse(entry.msgJson) as Msg,
    timestamp: entry.timestamp,
  }))
}
