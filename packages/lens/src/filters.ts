/**
 * Lens Filters - Common filter patterns for createLens
 *
 * These are pre-built filter functions for common use cases.
 * You can use them directly or as building blocks for custom filters.
 */

import type { CommitInfo, LensFilter } from "./types.js"

/**
 * Accept all commits (no filtering).
 *
 * This is the default behavior when no filter is provided to createLens.
 *
 * @example
 * ```typescript
 * const lens = createLens(source, { filter: filterNone })
 * ```
 */
export const filterNone: LensFilter = () => true

/**
 * Reject all commits (read-only doc for external changes).
 *
 * Useful for read-only projections or when you want to manually control
 * what external changes are applied. Note: source still receives all changes
 * for CRDT convergence - only doc is protected.
 *
 * @example
 * ```typescript
 * const lens = createLens(source, { filter: filterAll })
 * // External changes won't reach lens.doc
 * // Local changes via lens.change() still work
 * ```
 */
export const filterAll: LensFilter = () => false

/**
 * Create a filter that only accepts commits from trusted peers.
 *
 * @param trustedPeers - Array of peer IDs that are trusted
 * @returns A filter that only accepts commits from trusted peers
 *
 * @example
 * ```typescript
 * const lens = createLens(source, {
 *   filter: filterByPeers(["12345", "67890"])
 * })
 * ```
 */
export function filterByPeers(trustedPeers: string[]): LensFilter {
  const trustedSet = new Set(trustedPeers)
  return (info: CommitInfo) => trustedSet.has(info.peerId)
}

/**
 * Create a filter based on commit message content.
 *
 * Useful when identity or metadata is encoded in commit messages.
 * The message is already pre-parsed from JSON in CommitInfo.
 *
 * @param predicate - Function that receives the parsed message and returns true to accept
 * @returns A filter based on commit message content
 *
 * @example
 * ```typescript
 * // Filter by user ID in commit message
 * const lens = createLens(source, {
 *   filter: filterByMessage(
 *     (msg) => msg?.userId === myUserId
 *   )
 * })
 *
 * // Filter by role
 * const lens = createLens(source, {
 *   filter: filterByMessage(
 *     (msg) => msg?.role === "admin"
 *   )
 * })
 * ```
 */
export function filterByMessage<T = unknown>(
  predicate: (message: T | null) => boolean,
): LensFilter {
  return (info: CommitInfo) => predicate(info.message as T | null)
}

/**
 * Compose multiple filters with AND logic.
 *
 * All filters must return true for the commit to be accepted.
 * Filters are applied in order; short-circuits on first rejection.
 *
 * @param filters - Array of filters to compose
 * @returns A composed filter
 *
 * @example
 * ```typescript
 * const lens = createLens(source, {
 *   filter: composeFilters([
 *     filterByPeers(["12345", "67890"]),
 *     filterByMessage((msg) => msg?.role === "admin"),
 *   ])
 * })
 * ```
 */
export function composeFilters(filters: LensFilter[]): LensFilter {
  return (info: CommitInfo) => {
    for (const filter of filters) {
      if (!filter(info)) {
        return false
      }
    }
    return true
  }
}

/**
 * Create a filter that accepts commits matching ANY of the provided filters.
 *
 * At least one filter must return true for the commit to be accepted.
 * Filters are applied in order; short-circuits on first acceptance.
 *
 * @param filters - Array of filters to compose with OR logic
 * @returns A composed filter
 *
 * @example
 * ```typescript
 * const lens = createLens(source, {
 *   filter: anyFilter([
 *     filterByPeers(["admin-peer"]),
 *     filterByMessage((msg) => msg?.isSystem === true),
 *   ])
 * })
 * ```
 */
export function anyFilter(filters: LensFilter[]): LensFilter {
  return (info: CommitInfo) => {
    for (const filter of filters) {
      if (filter(info)) {
        return true
      }
    }
    return false
  }
}

/**
 * Negate a filter.
 *
 * @param filter - The filter to negate
 * @returns A filter that returns the opposite of the input filter
 *
 * @example
 * ```typescript
 * // Accept commits from everyone EXCEPT these peers
 * const lens = createLens(source, {
 *   filter: notFilter(filterByPeers(["blocked-peer"]))
 * })
 * ```
 */
export function notFilter(filter: LensFilter): LensFilter {
  return (info: CommitInfo) => !filter(info)
}
