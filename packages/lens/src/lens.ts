/**
 * Lens Implementation - Bidirectional filtered synchronization
 *
 * Creates a worldview (`doc`) from a world (`source`) with:
 * - World → Worldview: Commit-level filtered import
 * - Worldview → World: State-based applyDiff
 */

import {
  change as applyChange,
  createTypedDoc,
  type DocShape,
  loro,
  type Mutable,
} from "@loro-extended/change"
import type { Frontiers, JsonChange } from "loro-crdt"
import type { CommitInfo, Lens, LensFilter, LensOptions } from "./types.js"

/**
 * Processing state for the lens.
 * Explicit states make the control flow self-documenting.
 */
type ProcessingState =
  | "idle"
  | "filtering-world-to-worldview"
  | "propagating-worldview-to-world"
  | "applying-local-change"

/**
 * Default filter that accepts all commits.
 */
const acceptAll: LensFilter = () => true

/**
 * Compare two frontiers for equality.
 */
function frontiersEqual(a: Frontiers, b: Frontiers): boolean {
  if (a.length !== b.length) return false
  return a.every((f, i) => f.peer === b[i].peer && f.counter === b[i].counter)
}

/**
 * Parse a JsonChange into a typed CommitInfo object.
 * Provides convenient access to peer ID, counter, and parsed message.
 */
export function parseCommitInfo(commit: JsonChange): CommitInfo {
  const atIndex = commit.id.indexOf("@")
  const counter = parseInt(commit.id.slice(0, atIndex), 10)
  const peerId = commit.id.slice(atIndex + 1)

  let message: unknown
  if (commit.msg) {
    try {
      message = JSON.parse(commit.msg)
    } catch {
      message = undefined
    }
  }

  return {
    raw: commit,
    peerId,
    counter,
    timestamp: commit.timestamp,
    message,
  }
}

/**
 * Create a Lens from a world TypedDoc.
 *
 * The Lens creates a worldview (`doc`) from a world (`source`).
 * Changes flow bidirectionally:
 * - External imports to the world are filtered before reaching the worldview
 * - Local changes via `change()` propagate to the world via state-based diff
 *
 * @param world - The world TypedDoc (shared, converging state) to create a lens from
 * @param options - Optional configuration including filter function
 * @returns A Lens with doc (worldview), source (world), change(), and dispose()
 *
 * @example
 * ```typescript
 * // Basic usage with Repo Handle
 * const handle = repo.get("game-doc", GameSchema)
 * const lens = createLens(handle.doc, {
 *   filter: (info) => {
 *     const msg = info.message as { userId?: string } | undefined
 *     return msg?.userId === myUserId
 *   }
 * })
 *
 * // Read from lens.doc (filtered worldview)
 * const state = lens.doc.game.toJSON()
 *
 * // Write through lens.change()
 * lens.change(draft => {
 *   draft.game.players.alice.choice = "rock"
 * })
 *
 * // Cleanup
 * lens.dispose()
 * ```
 *
 * @example
 * ```typescript
 * // Chained lenses (composition)
 * const adminLens = createLens(handle.doc, {
 *   filter: (info) => {
 *     const msg = info.message as { role?: string } | undefined
 *     return msg?.role === "admin"
 *   }
 * })
 *
 * const recentLens = createLens(adminLens.doc, {
 *   filter: (info) => info.timestamp > Date.now() / 1000 - 3600
 * })
 * ```
 */
export function createLens<D extends DocShape>(
  source: import("@loro-extended/change").TypedDoc<D>,
  options?: LensOptions,
): Lens<D> {
  // Get filter from options, default to accept all
  const filter = options?.filter ?? acceptAll

  // Extract LoroDoc and shape from world TypedDoc
  // (internally we use sourceLoroDoc/docLoroDoc for the underlying LoroDoc instances)
  const sourceLoroDoc = loro(source).doc
  const docShape = loro(source).docShape as D

  // Create worldview as a fork with preserved peer ID
  // This keeps the version vector small and ensures local writes
  // appear as the same peer in both documents.
  const docLoroDoc = sourceLoroDoc.fork()
  docLoroDoc.setPeerId(sourceLoroDoc.peerId)

  // Create TypedDoc wrapper for worldview
  const doc = createTypedDoc(docShape, docLoroDoc)

  // Explicit processing state for self-documenting control flow
  let processingState: ProcessingState = "idle"
  let isDisposed = false

  // Track last known frontiers for detecting changes
  let lastKnownSourceFrontiers = sourceLoroDoc.frontiers()
  let lastKnownDocFrontiers = docLoroDoc.frontiers()

  /**
   * Centralized frontier synchronization.
   * Call this after any operation that modifies either document.
   */
  function syncFrontiers(): void {
    lastKnownSourceFrontiers = sourceLoroDoc.frontiers()
    lastKnownDocFrontiers = docLoroDoc.frontiers()
  }

  /**
   * Filter changes from world to worldview.
   *
   * Implements commit-level filtering with causal consistency:
   * if commit N from a peer is rejected, all subsequent commits
   * (N+1, N+2, etc.) from that peer in the same batch are also rejected.
   */
  function filterWorldToWorldview(
    worldFrontiersBefore: Frontiers,
    worldFrontiersAfter: Frontiers,
  ): void {
    processingState = "filtering-world-to-worldview"
    try {
      filterWorldToWorldviewInternal(worldFrontiersBefore, worldFrontiersAfter)
    } finally {
      syncFrontiers()
      processingState = "idle"
    }
  }

  function filterWorldToWorldviewInternal(
    worldFrontiersBefore: Frontiers,
    worldFrontiersAfter: Frontiers,
  ): void {
    const spans = sourceLoroDoc.findIdSpansBetween(
      worldFrontiersBefore,
      worldFrontiersAfter,
    )

    // Type for OpId peer is `${number}` (a string that looks like a number)
    type OpIdPeer = `${number}`
    const validSpans: Array<{
      id: { peer: OpIdPeer; counter: number }
      len: number
    }> = []

    // Track which peers have had a rejection - we must stop accepting
    // subsequent commits from that peer to maintain causal consistency
    const rejectedPeers = new Set<string>()

    for (const span of spans.forward) {
      // Get all changes (commits) in this span
      const changes = sourceLoroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })

      // Track accepted changes with their counter ranges
      // Each change starts at its counter and extends to the next change's counter
      // (or to the end of the span for the last change)
      const acceptedRanges: Array<{
        peer: OpIdPeer
        startCounter: number
        endCounter: number // exclusive
      }> = []

      for (let i = 0; i < changes.length; i++) {
        const jsonChange = changes[i]

        // Parse change.id to get peer and counter (format: "counter@peer")
        const atIndex = jsonChange.id.indexOf("@")
        const counter = parseInt(jsonChange.id.slice(0, atIndex), 10)
        const changePeer = jsonChange.id.slice(atIndex + 1)

        // If this peer has already had a rejection, skip all subsequent commits
        // from them to maintain causal consistency
        if (rejectedPeers.has(changePeer)) {
          continue
        }

        // Parse commit info for the filter
        const commitInfo = parseCommitInfo(jsonChange)

        // Call filter for each commit with exception safety
        // If filter throws, we reject the commit to prevent inconsistent state
        let isValid: boolean
        try {
          isValid = Boolean(filter(commitInfo))
        } catch {
          // Filter threw an exception - reject this commit to prevent inconsistent state
          // Note: We silently reject rather than logging because this is a library
          // and we don't want to pollute the consumer's console
          isValid = false
        }

        if (isValid) {
          // Calculate the end counter for this change
          // It extends to the next change's counter, or to the end of the span
          const nextChange = changes[i + 1]
          let endCounter: number
          if (nextChange) {
            const nextAtIndex = nextChange.id.indexOf("@")
            endCounter = parseInt(nextChange.id.slice(0, nextAtIndex), 10)
          } else {
            // Last change extends to the end of the span
            endCounter = span.counter + span.length
          }

          acceptedRanges.push({
            peer: span.peer,
            startCounter: counter,
            endCounter,
          })
        } else {
          // Mark this peer as rejected - all subsequent commits from them
          // in this batch will be skipped
          rejectedPeers.add(changePeer)
        }
      }

      // Convert accepted ranges to valid spans
      // Merge adjacent ranges for efficiency
      for (const range of acceptedRanges) {
        const len = range.endCounter - range.startCounter
        if (len > 0) {
          validSpans.push({
            id: { peer: range.peer, counter: range.startCounter },
            len,
          })
        }
      }
    }

    // If all rejected, we're done (world still has the changes)
    if (validSpans.length === 0) {
      return
    }

    // Export valid changes and import to worldview
    const validBytes = sourceLoroDoc.export({
      mode: "updates-in-range",
      spans: validSpans,
    })
    docLoroDoc.import(validBytes)
  }

  /**
   * Process changes to the world (from external imports or chained lens propagation).
   *
   * Called when the world changes (detected via subscription).
   * Filters the new commits and applies accepted ones to the worldview.
   *
   * We listen for both "import" and "local" events because:
   * - "import": External peer data arriving
   * - "local": Changes from a chained lens propagating via applyDiff
   */
  function processWorldChange(): void {
    if (isDisposed || processingState !== "idle") return

    const worldFrontiersAfter = sourceLoroDoc.frontiers()

    // Check if frontiers actually changed
    if (frontiersEqual(lastKnownSourceFrontiers, worldFrontiersAfter)) return

    const worldFrontiersBefore = lastKnownSourceFrontiers
    lastKnownSourceFrontiers = worldFrontiersAfter

    filterWorldToWorldview(worldFrontiersBefore, worldFrontiersAfter)
  }

  // Subscribe to world for changes (external imports and parent lens changes)
  const unsubscribeWorld = sourceLoroDoc.subscribe(event => {
    // Process import events from external peers
    // AND local events from parent lens's change() method
    if (event.by === "import" || event.by === "local") {
      processWorldChange()
    }
  })

  /**
   * Process changes to worldview from a chained lens.
   *
   * When a chained lens (lens2) applies changes to this lens's worldview via applyDiff,
   * we need to propagate those changes to our world.
   *
   * Important: We only propagate the NEW changes (delta), not the entire state.
   * This preserves the world's state that was filtered out from the worldview.
   */
  function processWorldviewChange(): void {
    if (isDisposed || processingState !== "idle") return

    const worldviewFrontiersAfter = docLoroDoc.frontiers()

    // Check if worldview frontiers actually changed
    if (frontiersEqual(lastKnownDocFrontiers, worldviewFrontiersAfter)) return

    const worldviewFrontiersBefore = lastKnownDocFrontiers

    processingState = "propagating-worldview-to-world"
    try {
      // Get the diff of just the NEW changes to worldview (not the entire state)
      const diff = docLoroDoc.diff(
        worldviewFrontiersBefore,
        worldviewFrontiersAfter,
        false,
      )
      sourceLoroDoc.applyDiff(diff)
      sourceLoroDoc.commit()

      // Centralized frontier sync
      syncFrontiers()
    } finally {
      processingState = "idle"
    }
  }

  // Subscribe to worldview for changes from chained lenses
  const unsubscribeWorldview = docLoroDoc.subscribe(event => {
    // Process local events (from chained lens applyDiff)
    if (event.by === "local") {
      processWorldviewChange()
    }
  })

  /**
   * Process local change: worldview → applyDiff → world
   *
   * Uses applyDiff (state-based) instead of op-based import to avoid
   * causal history issues. This ensures local changes "win" regardless
   * of concurrent peer changes that were filtered out.
   */
  function processLocalChange(fn: (draft: Mutable<D>) => void): void {
    if (isDisposed) return

    processingState = "applying-local-change"
    try {
      // Capture frontiers before change
      const worldviewFrontiersBefore = docLoroDoc.frontiers()

      // Apply change to worldview
      applyChange(doc, fn)

      // Capture frontiers after change
      const worldviewFrontiersAfter = docLoroDoc.frontiers()

      // Check if anything changed
      if (frontiersEqual(worldviewFrontiersBefore, worldviewFrontiersAfter))
        return

      // Use applyDiff (state-based) to propagate to world
      // This avoids causal history issues - local changes "win"
      const diff = docLoroDoc.diff(
        worldviewFrontiersBefore,
        worldviewFrontiersAfter,
        false,
      )
      sourceLoroDoc.applyDiff(diff)
      sourceLoroDoc.commit()

      // Centralized frontier sync
      syncFrontiers()
    } finally {
      processingState = "idle"
    }
  }

  return {
    get doc() {
      return doc
    },
    get source() {
      return source
    },
    change: processLocalChange,
    dispose() {
      if (!isDisposed) {
        isDisposed = true
        unsubscribeWorld()
        unsubscribeWorldview()
      }
    },
  }
}
