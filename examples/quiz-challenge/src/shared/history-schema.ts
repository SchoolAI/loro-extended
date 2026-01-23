import { Shape } from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// History Document Schema - SEPARATE from app schema
// ═══════════════════════════════════════════════════════════════════════════
//
// This schema defines a separate document for tracking state transition history.
// The history document is NEVER checked out, ensuring subscriptions always fire
// when new entries arrive from peers.
//
// Pattern:
// - App document (`quiz-123`) - contains quiz state, can be checked out
// - History document (`quiz-123:history`) - contains history entries only,
//   NEVER checked out, always stays at latest
//
// When a message is dispatched:
// - App document: state is updated via the update function
// - History document: a new entry is appended via a reactor

export const HistoryEntrySchema = Shape.struct({
  /** Unique identifier for the entry */
  id: Shape.plain.string(),
  /** The message type (e.g., "START_QUIZ", "SELECT_OPTION") */
  msgType: Shape.plain.string(),
  /** JSON stringified message payload */
  msgJson: Shape.plain.string(),
  /** Timestamp when the message was dispatched */
  timestamp: Shape.plain.number(),
})

export const HistoryDocSchema = Shape.doc({
  /** List of history entries in chronological order */
  entries: Shape.list(HistoryEntrySchema),
})

// ═══════════════════════════════════════════════════════════════════════════
// Helper to derive history document ID from app document ID
// ═══════════════════════════════════════════════════════════════════════════

export function getHistoryDocId(appDocId: string): string {
  return `${appDocId}:history`
}
