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

import type {
  ChangeOptions,
  DocShape,
  Draft,
  EXT_SYMBOL,
  TypedDoc,
} from "@loro-extended/change"
import type { JsonChange } from "loro-crdt"

// Re-export ChangeOptions from @loro-extended/change for convenience
export type { ChangeOptions } from "@loro-extended/change"

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
 * Debug logging function type.
 * Accepts a message string and optional additional arguments.
 *
 * @example
 * ```typescript
 * // Use console.log
 * const lens = createLens(world, { debug: console.log })
 *
 * // Use a custom logger
 * const lens = createLens(world, {
 *   debug: (msg, ...args) => myLogger.debug(`[Lens] ${msg}`, ...args)
 * })
 * ```
 */
export type DebugFn = (message: string, ...args: unknown[]) => void

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

  /**
   * Debug logging function.
   * When provided, the lens will log internal operations for debugging.
   *
   * @example
   * ```typescript
   * // Simple console logging
   * const lens = createLens(world, { debug: console.log })
   *
   * // Custom logger
   * const lens = createLens(world, {
   *   debug: (msg) => console.log(`[Lens ${Date.now()}] ${msg}`)
   * })
   * ```
   */
  debug?: DebugFn
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
 * - Local changes via `change(lens, fn, options?)` propagate to the world via state-based diff
 *
 * @typeParam D - The document shape
 *
 * @example
 * ```typescript
 * import { createLens, change } from "@loro-extended/lens"
 *
 * const lens = createLens(world, {
 *   filter: (info) => {
 *     const msg = info.message as { userId?: string } | undefined
 *     return msg?.userId === myUserId
 *   }
 * })
 *
 * // Read from the worldview (filtered)
 * const state = lens.worldview.toJSON()
 *
 * // Write through the lens (propagates to world)
 * change(lens, draft => {
 *   draft.game.players.alice.choice = "rock"
 * }, { commitMessage: { playerId: "alice" } })
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
  readonly worldview: TypedDoc<D>

  /**
   * The world (shared, converging state).
   *
   * This is the original document passed to createLens.
   * It receives all commits (for CRDT convergence) and is
   * typically synced externally (e.g., via Repo).
   */
  readonly world: TypedDoc<D>

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

  /**
   * Internal symbol for change() detection.
   * Use `change(lens, fn, options?)` instead of accessing this directly.
   * @internal
   */
  readonly [EXT_SYMBOL]: {
    change: (fn: (draft: Draft<D>) => void, options?: ChangeOptions) => void
  }
}
