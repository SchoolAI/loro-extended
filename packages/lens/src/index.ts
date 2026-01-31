/**
 * @loro-extended/lens
 *
 * Composable bidirectional filtered synchronization for Loro TypedDoc.
 *
 * A Lens provides a filtered worldview of a world TypedDoc.
 * Changes flow bidirectionally:
 * - World → Worldview: Commit-level filtered import (preserves causal history)
 * - Worldview → World: State-based applyDiff (avoids causal history issues)
 *
 * @example
 * ```typescript
 * import { createLens, filterByMessage } from "@loro-extended/lens"
 *
 * // Create a lens with filtering
 * const lens = createLens(worldDoc, {
 *   filter: filterByMessage((msg) => msg?.userId === myUserId)
 * })
 *
 * // Read from the filtered worldview
 * const state = lens.worldview.toJSON()
 *
 * // Write through the lens with commit message (propagates to world)
 * lens.change(draft => {
 *   draft.game.players.alice.choice = "rock"
 * }, { commitMessage: { playerId: "alice" } })
 *
 * // Cleanup when done
 * lens.dispose()
 * ```
 *
 * @packageDocumentation
 */

// Filters
export {
  anyFilter,
  composeFilters,
  filterAll,
  filterByMessage,
  filterByPeers,
  filterNone,
  notFilter,
} from "./filters.js"
// Core
export { createLens, parseCommitInfo } from "./lens.js"
// Types
export type {
  ChangeOptions,
  CommitInfo,
  Lens,
  LensFilter,
  LensOptions,
} from "./types.js"
