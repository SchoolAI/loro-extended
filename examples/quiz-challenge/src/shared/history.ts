import { type Frontiers, loro, type TypedDoc } from "@loro-extended/change"
import type { QuizMsg } from "./messages.js"
import type { QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - History Utilities
// ═══════════════════════════════════════════════════════════════════════════
//
// These utilities enable time travel debugging by retrieving the message
// history from commit annotations stored in the LoroDoc.
//
// Pattern: Each dispatch stores the message as a commit annotation via
// setNextCommitMessage(). This module retrieves those annotations using
// travelChangeAncestors() to build a chronological history.

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type HistoryEntry = {
  /** Unique identifier: `${counter}@${peer}` */
  id: string
  /** The dispatched message */
  msg: QuizMsg
  /** When the message was dispatched (Date.now() at dispatch time) */
  timestamp: number
  /** The frontier after this change was applied */
  frontier: Frontiers
}

/** The format stored in commit messages */
type CommitMessageData = {
  type: string
  msg: QuizMsg
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// getMessageHistory
// ═══════════════════════════════════════════════════════════════════════════
//
// Retrieves the message history from commit annotations.
//
// Uses travelChangeAncestors() which traverses in reverse causal order,
// so we reverse the result to get chronological order.
//
// Changes without commit messages (e.g., sensor writes) are skipped.
// Malformed commit messages are also skipped gracefully.

export function getMessageHistory(
  doc: TypedDoc<typeof QuizDocSchema>,
  fromFrontiers?: Frontiers,
): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const frontiers = fromFrontiers ?? loro(doc).doc.frontiers()

  loro(doc).doc.travelChangeAncestors(frontiers, change => {
    if (change.message) {
      try {
        const data = JSON.parse(change.message) as CommitMessageData
        // Validate that this looks like a message commit
        if (data.type && data.msg) {
          // The frontier should be at the END of the change (counter + length - 1)
          // This ensures we include all operations in the change
          const endCounter = change.counter + change.length - 1
          entries.push({
            id: `${change.counter}@${change.peer}`,
            msg: data.msg,
            timestamp: data.timestamp ?? change.timestamp * 1000,
            frontier: [{ peer: change.peer, counter: endCounter }],
          })
        }
      } catch {
        // Skip malformed commit messages (not JSON or wrong structure)
      }
    }
    return true // Continue traversing
  })

  // travelChangeAncestors returns in reverse causal order, so reverse for chronological
  return entries.reverse()
}

// ═══════════════════════════════════════════════════════════════════════════
// getFrontierForEntry
// ═══════════════════════════════════════════════════════════════════════════
//
// Converts a history entry's frontier to the format needed for checkout.
// The frontier stored in HistoryEntry is the OpId of the change itself.
// For checkout, we need to include all concurrent changes up to that point.

export function getFrontierForEntry(entry: HistoryEntry): Frontiers {
  return entry.frontier
}
