/**
 * Lens Implementation - Bidirectional filtered synchronization
 *
 * Creates a worldview (`doc`) from a world (`source`) with:
 * - World → Worldview: Commit-level filtered import
 * - Worldview → World: State-based applyDiff
 */

import {
  createTypedDoc,
  type DocShape,
  loro,
  type Mutable,
  type TypedDoc,
} from "@loro-extended/change"
import type { Frontiers, JsonChange, LoroDoc } from "loro-crdt"
import type {
  ChangeOptions,
  CommitInfo,
  Lens,
  LensFilter,
  LensOptions,
} from "./types.js"

/**
 * Module-level WeakMap for inter-lens message passing.
 *
 * This enables commit messages to propagate through chained lenses.
 * When a child lens commits to its world (parent's worldview), it stores
 * the message here. The parent lens's subscription retrieves it synchronously.
 *
 * WeakMap is safe because:
 * 1. Loro subscriptions fire synchronously during commit()
 * 2. JavaScript is single-threaded, so each lens.change() completes fully
 *    (including all subscription callbacks) before the next one starts
 * 3. The entry is set before commit() and retrieved/deleted during the
 *    synchronous subscription callback
 */
const pendingMessages = new WeakMap<LoroDoc, string>()

/**
 * Serialize a commit message to a string.
 *
 * - String messages are returned as-is
 * - Object messages are JSON-serialized
 * - Handles serialization errors gracefully (returns undefined)
 */
function serializeMessage(
  message: string | object | undefined,
): string | undefined {
  if (message === undefined) return undefined
  if (typeof message === "string") return message
  try {
    return JSON.stringify(message)
  } catch {
    // Handle circular references, BigInt, etc.
    return undefined
  }
}

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
 * The Lens creates a worldview from a world.
 * Changes flow bidirectionally:
 * - External imports to the world are filtered before reaching the worldview
 * - Local changes via `change()` propagate to the world via state-based diff
 *
 * @param world - The world TypedDoc (shared, converging state) to create a lens from
 * @param options - Optional configuration including filter function
 * @returns A Lens with worldview, world, change(), and dispose()
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
  world: TypedDoc<D>,
  options?: LensOptions,
): Lens<D> {
  // Get filter from options, default to accept all
  const filter = options?.filter ?? acceptAll

  // Extract LoroDoc and shape from world TypedDoc
  // (internally we use sourceLoroDoc/docLoroDoc for the underlying LoroDoc instances)
  const worldLoroDoc = loro(world).doc
  const worldShape = loro(world).docShape as D

  // Create worldview as a fork with preserved peer ID
  // This keeps the version vector small and ensures local writes
  // appear as the same peer in both documents.
  const worldviewLoroDoc = worldLoroDoc.fork()
  worldviewLoroDoc.setPeerId(worldLoroDoc.peerId)

  // Create TypedDoc wrapper for worldview
  const worldviewDoc = createTypedDoc(worldShape, { doc: worldviewLoroDoc })

  // Explicit processing state for self-documenting control flow
  let processingState: ProcessingState = "idle"
  let isDisposed = false

  // Track last known frontiers for detecting changes
  let lastKnownWorldFrontiers = worldLoroDoc.frontiers()
  let lastKnownWorldviewFrontiers = worldviewLoroDoc.frontiers()

  /**
   * Centralized frontier synchronization.
   * Call this after any operation that modifies either document.
   */
  function syncFrontiers(): void {
    lastKnownWorldFrontiers = worldLoroDoc.frontiers()
    lastKnownWorldviewFrontiers = worldviewLoroDoc.frontiers()
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
    const spans = worldLoroDoc.findIdSpansBetween(
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
      const changes = worldLoroDoc.exportJsonInIdSpan({
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
    const validBytes = worldLoroDoc.export({
      mode: "updates-in-range",
      spans: validSpans,
    })
    worldviewLoroDoc.import(validBytes)
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

    const worldFrontiersAfter = worldLoroDoc.frontiers()

    // Check if frontiers actually changed
    if (frontiersEqual(lastKnownWorldFrontiers, worldFrontiersAfter)) return

    const worldFrontiersBefore = lastKnownWorldFrontiers
    lastKnownWorldFrontiers = worldFrontiersAfter

    filterWorldToWorldview(worldFrontiersBefore, worldFrontiersAfter)
  }

  // Subscribe to world for changes (external imports and parent lens changes)
  const unsubscribeWorld = worldLoroDoc.subscribe(event => {
    // Process import events from external peers
    // AND local events from parent lens's change() method
    if (event.by === "import" || event.by === "local") {
      processWorldChange()
    }
  })

  /**
   * Unified propagation from worldview to world.
   *
   * Propagates the delta (new changes only) from worldview to world,
   * preserving the world's state that was filtered out from the worldview.
   *
   * @param worldviewFrontiersBefore - Frontiers before the change
   * @param commitMessage - Optional commit message to attach
   */
  function propagateToWorld(
    worldviewFrontiersBefore: Frontiers,
    commitMessage?: string,
  ): void {
    const worldviewFrontiersAfter = worldviewLoroDoc.frontiers()

    // Check if worldview frontiers actually changed
    if (frontiersEqual(worldviewFrontiersBefore, worldviewFrontiersAfter))
      return

    // Get the diff of just the NEW changes to worldview (not the entire state)
    const diff = worldviewLoroDoc.diff(
      worldviewFrontiersBefore,
      worldviewFrontiersAfter,
      false,
    )
    worldLoroDoc.applyDiff(diff)

    if (commitMessage) {
      worldLoroDoc.setNextCommitMessage(commitMessage)
      // Store for parent lens to pick up (for chained lenses)
      pendingMessages.set(worldLoroDoc, commitMessage)
    }
    worldLoroDoc.commit()

    // Centralized frontier sync
    syncFrontiers()
  }

  // Subscribe to worldview for changes from chained lenses
  const unsubscribeWorldview = worldviewLoroDoc.subscribe(event => {
    // Process local events (from chained lens applyDiff)
    if (event.by === "local") {
      if (isDisposed || processingState !== "idle") return

      // Retrieve pending message from child lens (if any)
      const pendingMessage = pendingMessages.get(worldviewLoroDoc)
      pendingMessages.delete(worldviewLoroDoc)

      processingState = "propagating-worldview-to-world"
      try {
        propagateToWorld(lastKnownWorldviewFrontiers, pendingMessage)
      } finally {
        processingState = "idle"
      }
    }
  })

  /**
   * Process local change: worldview → applyDiff → world
   *
   * Uses applyDiff (state-based) instead of op-based import to avoid
   * causal history issues. This ensures local changes "win" regardless
   * of concurrent peer changes that were filtered out.
   *
   * @param fn - Mutation function that modifies the draft
   * @param options - Optional configuration including commit message
   */
  function processLocalChange(
    fn: (draft: Mutable<D>) => void,
    options?: ChangeOptions,
  ): void {
    if (isDisposed) return

    processingState = "applying-local-change"
    try {
      // Capture frontiers before change
      const worldviewFrontiersBefore = worldviewLoroDoc.frontiers()

      // Apply change to worldview
      worldviewDoc.change(fn)

      // Serialize commit message (handles string/object)
      const serializedMessage = serializeMessage(options?.commitMessage)

      // Propagate to world with commit message
      propagateToWorld(worldviewFrontiersBefore, serializedMessage)
    } finally {
      processingState = "idle"
    }
  }

  return {
    get worldview() {
      return worldviewDoc
    },
    get world() {
      return world
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
