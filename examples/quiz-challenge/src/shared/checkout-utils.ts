import type { Frontiers } from "@loro-extended/change"
import type { LoroDoc } from "loro-crdt"

// ═══════════════════════════════════════════════════════════════════════════
// Checkout Utilities
// ═══════════════════════════════════════════════════════════════════════════
//
// Utilities for time travel operations on Loro documents.
//
// Key distinction:
// - checkout(frontier) - Moves to a specific historical point, document becomes DETACHED
// - checkoutToLatest() - Returns to live state, document becomes ATTACHED
//
// Even if you checkout to the latest frontier, the document remains detached.
// Use checkoutToLatest() to properly re-attach.

/**
 * Check if a frontier represents the latest state of the document.
 * Uses Loro's built-in cmpFrontiers for efficient and accurate comparison.
 *
 * cmpFrontiers returns:
 * - 0: frontiers are equal
 * - -1: a < b (a is an ancestor of b)
 * - 1: a > b (a is a descendant of b)
 * - undefined: a ∥ b (concurrent, neither is ancestor of the other)
 */
export function isLatestFrontier(doc: LoroDoc, frontier: Frontiers): boolean {
  const oplogFrontiers = doc.oplogFrontiers()
  return doc.cmpFrontiers(frontier, oplogFrontiers) === 0
}

/**
 * Checkout to a frontier, or use checkoutToLatest() if it's the latest.
 * This ensures the document is properly attached when returning to live state.
 */
export function checkoutToFrontier(doc: LoroDoc, frontier: Frontiers): void {
  if (isLatestFrontier(doc, frontier)) {
    // Use checkoutToLatest to properly re-attach the document
    doc.checkoutToLatest()
  } else {
    // Checkout to historical state (document becomes detached)
    doc.checkout(frontier)
  }
}
