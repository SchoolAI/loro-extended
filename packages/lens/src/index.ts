/**
 * @loro-extended/lens
 *
 * Composable bidirectional filtered synchronization for Loro TypedDoc.
 *
 * A Lens provides a filtered projection (doc) of a source TypedDoc (world).
 * Changes flow bidirectionally:
 * - Source → Doc: Commit-level filtered import (preserves causal history)
 * - Doc → Source: State-based applyDiff (avoids causal history issues)
 *
 * @example
 * ```typescript
 * import { createLens, filterByMessage } from "@loro-extended/lens"
 *
 * // Create a lens with filtering
 * const lens = createLens(sourceDoc, {
 *   filter: filterByMessage((msg) => msg?.userId === myUserId)
 * })
 *
 * // Read from the filtered projection
 * const state = lens.doc.toJSON()
 *
 * // Write through the lens (propagates to source)
 * lens.change(draft => {
 *   draft.game.players.alice.choice = "rock"
 * })
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
export type { CommitInfo, Lens, LensFilter, LensOptions } from "./types.js"
