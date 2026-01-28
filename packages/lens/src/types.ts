/**
 * Lens Types - Bidirectional filtered synchronization primitives
 *
 * A Lens creates a worldview (`doc`) from a world (`source`).
 * The worldview is your filtered perspective on the shared world.
 *
 * Changes flow bidirectionally:
 * - World → Worldview: Commit-level filtered import (preserves causal history)
 * - Worldview → World: State-based applyDiff (avoids causal history issues)
 */

import type { DocShape, Mutable, TypedDoc } from "@loro-extended/change"
import type { JsonChange } from "loro-crdt"

/**
 * Commit information with convenient access to common fields.
 *
 * Provides pre-parsed access to:
 * - Peer ID and counter from the commit ID
 * - Parsed message (if valid JSON)
 * - Timestamp
 * - Raw JsonChange for advanced use cases
 *
 * @example
 * ```typescript
 * const filter: LensFilter = (info) => {
 *   return info.peerId === "12345" && info.message?.role === "admin"
 * }
 * ```
 */
export interface CommitInfo {
  /** The raw JsonChange for advanced use cases */
  raw: JsonChange
  /** The peer ID extracted from commit.id */
  peerId: string
  /** The counter extracted from commit.id */
  counter: number
  /** Unix timestamp in seconds */
  timestamp: number
  /** Parsed JSON message, or undefined if not valid JSON */
  message: unknown
}

/**
 * Filter function for incoming commits.
 *
 * Called for each commit when changes are imported to the world.
 * Return `true` to accept the commit (apply to worldview), `false` to reject.
 *
 * The filter receives pre-parsed CommitInfo with:
 * - `peerId`: The peer ID extracted from commit.id
 * - `counter`: The counter extracted from commit.id
 * - `timestamp`: Unix timestamp in seconds
 * - `message`: Parsed JSON message, or undefined
 * - `raw`: The original JsonChange for advanced use cases
 *
 * @example
 * ```typescript
 * // Accept all commits (default)
 * const acceptAll: LensFilter = () => true
 *
 * // Filter by peer ID
 * const filterByPeer: LensFilter = (info) => {
 *   return trustedPeers.includes(info.peerId)
 * }
 *
 * // Filter by commit message content
 * const filterByRole: LensFilter = (info) => {
 *   const msg = info.message as { role?: string } | undefined
 *   return msg?.role === "admin"
 * }
 * ```
 */
export type LensFilter = (info: CommitInfo) => boolean

/**
 * Options for creating a Lens.
 */
export interface LensOptions {
  /**
   * Filter function for incoming commits.
   * Receives pre-parsed CommitInfo with peer ID, counter, timestamp, and message.
   * Default: accept all commits.
   *
   * @example
   * ```typescript
   * const lens = createLens(world, {
   *   filter: (info) => {
   *     return info.peerId === myPeerId && info.message?.allowed === true
   *   }
   * })
   * ```
   */
  filter?: LensFilter
}

/**
 * A Lens provides bidirectional filtered synchronization between
 * a world (`source`) and a worldview (`doc`).
 *
 * - **source**: The world—the shared, converging document (synced externally)
 * - **doc**: The worldview—your filtered perspective (UI reads from here)
 *
 * Changes flow bidirectionally:
 * - External imports to the world are filtered before reaching the worldview
 * - Local changes via `change()` propagate to the world via state-based diff
 *
 * @typeParam D - The document shape
 *
 * @example
 * ```typescript
 * const lens = createLens(world, {
 *   filter: (info) => {
 *     const msg = info.message as { userId?: string } | undefined
 *     return msg?.userId === myUserId
 *   }
 * })
 *
 * // Read from the worldview (filtered)
 * const state = lens.doc.toJSON()
 *
 * // Write through the lens (propagates to world)
 * lens.change(draft => {
 *   draft.game.players.alice.choice = "rock"
 * })
 *
 * // Cleanup when done
 * lens.dispose()
 * ```
 */
export interface Lens<D extends DocShape> {
  /**
   * The worldview (filtered perspective).
   *
   * UI components should read from this document.
   * It contains only the commits that passed the filter.
   */
  readonly doc: TypedDoc<D>

  /**
   * The world (shared, converging state).
   *
   * This is the original document passed to createLens.
   * It receives all commits (for CRDT convergence) and is
   * typically synced externally (e.g., via Repo).
   */
  readonly source: TypedDoc<D>

  /**
   * Apply a local change to the worldview.
   *
   * The change is applied to the worldview first, then propagated to the world
   * via state-based diff (applyDiff). This ensures local changes
   * "win" regardless of concurrent peer changes that were filtered out.
   *
   * Local changes bypass the filter (they're trusted local code).
   *
   * @param fn - Mutation function that modifies the draft
   *
   * @example
   * ```typescript
   * lens.change(draft => {
   *   draft.game.players.alice.choice = "rock"
   *   draft.game.players.alice.locked = true
   * })
   * ```
   */
  change(fn: (draft: Mutable<D>) => void): void

  /**
   * Clean up resources and stop the lens.
   *
   * After disposal:
   * - Subscriptions to the world are unsubscribed
   * - Further operations are no-ops
   *
   * Always call dispose() when the lens is no longer needed.
   */
  dispose(): void
}
