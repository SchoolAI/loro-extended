/**
 * Lens Implementation - Bidirectional filtered synchronization
 *
 * Creates a worldview (`doc`) from a world (`source`) with:
 * - World → Worldview: Commit-level filtered import
 * - Worldview → World: State-based applyDiff
 *
 * Architecture:
 * - One world subscription (filter external changes)
 * - One worldview subscription (propagate chained lens changes)
 * - One change processor (queue + apply + propagate)
 * - Fresh frontier capture eliminates stale state bugs
 */

import {
  type ChangeOptions,
  createTypedDoc,
  type DocShape,
  EXT_SYMBOL,
  ext,
  loro,
  type Mutable,
  serializeCommitMessage,
  type TypedDoc,
} from "@loro-extended/change"
import type { Frontiers, JsonChange, LoroDoc } from "loro-crdt"
import type {
  CommitInfo,
  DebugFn,
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
 * Re-entrancy is supported: calling `change(lens, ...)` inside a subscription
 * callback will queue the change and process it after the current change completes.
 *
 * @param world - The world TypedDoc (shared, converging state) to create a lens from
 * @param options - Optional configuration including filter function
 * @returns A Lens with worldview, world, change(), and dispose()
 */
export function createLens<D extends DocShape>(
  world: TypedDoc<D>,
  options?: LensOptions,
): Lens<D> {
  const filter = options?.filter ?? acceptAll
  const debug: DebugFn | undefined = options?.debug

  const worldLoroDoc = loro(world)
  const worldShape = ext(world).docShape as D

  // Create worldview as a fork with its own unique peer ID.
  // Different peer IDs are safe because:
  // - Outbound (worldview → world): applyDiff + commit creates new ops with world's peerId
  // - Inbound (world → worldview): import preserves original authors' peerIds
  // Using separate peer IDs avoids potential (peerId, counter) collisions and
  // aligns with Loro's expectations about peer ID uniqueness.
  const worldviewLoroDoc = worldLoroDoc.fork()

  const worldviewDoc = createTypedDoc(worldShape, { doc: worldviewLoroDoc })

  debug?.(`created lens with peerId=${worldLoroDoc.peerId}`)

  // ============================================
  // STATE: Minimal state for correct operation
  // ============================================

  let isDisposed = false
  let isProcessing = false

  // Queue for re-entrant change calls
  const changeQueue: Array<{
    fn: (draft: Mutable<D>) => void
    options?: ChangeOptions
  }> = []

  // Track world frontiers for filtering
  let lastKnownWorldFrontiers = worldLoroDoc.frontiers()

  // Track worldview frontiers for chained lens propagation
  // This is needed because worldview has a different peerId than world,
  // so we can't use world's frontiers when computing diffs on worldview
  let lastKnownWorldviewFrontiers = worldviewLoroDoc.frontiers()

  // ============================================
  // FILTERING: World → Worldview
  // ============================================

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
    const spans = worldLoroDoc.findIdSpansBetween(
      worldFrontiersBefore,
      worldFrontiersAfter,
    )

    type OpIdPeer = `${number}`
    const validSpans: Array<{
      id: { peer: OpIdPeer; counter: number }
      len: number
    }> = []

    // Track which peers have had a rejection - we must stop accepting
    // subsequent commits from that peer to maintain causal consistency
    const rejectedPeers = new Set<string>()

    for (const span of spans.forward) {
      const changes = worldLoroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })

      const acceptedRanges: Array<{
        peer: OpIdPeer
        startCounter: number
        endCounter: number
      }> = []

      for (let i = 0; i < changes.length; i++) {
        const jsonChange = changes[i]

        const atIndex = jsonChange.id.indexOf("@")
        const counter = parseInt(jsonChange.id.slice(0, atIndex), 10)
        const changePeer = jsonChange.id.slice(atIndex + 1)

        if (rejectedPeers.has(changePeer)) {
          continue
        }

        const commitInfo = parseCommitInfo(jsonChange)

        let isValid: boolean
        try {
          isValid = Boolean(filter(commitInfo))
        } catch {
          isValid = false
        }

        if (isValid) {
          const nextChange = changes[i + 1]
          let endCounter: number
          if (nextChange) {
            const nextAtIndex = nextChange.id.indexOf("@")
            endCounter = parseInt(nextChange.id.slice(0, nextAtIndex), 10)
          } else {
            endCounter = span.counter + span.length
          }

          acceptedRanges.push({
            peer: span.peer,
            startCounter: counter,
            endCounter,
          })
        } else {
          rejectedPeers.add(changePeer)
        }
      }

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

    if (validSpans.length === 0) {
      debug?.(`filter: all commits rejected`)
      return
    }

    debug?.(
      `filter: accepted ${validSpans.length} spans, rejected peers: ${rejectedPeers.size}`,
    )

    const validBytes = worldLoroDoc.export({
      mode: "updates-in-range",
      spans: validSpans,
    })
    worldviewLoroDoc.import(validBytes)
  }

  // Subscribe to world for changes (external imports and parent lens changes)
  const unsubscribeWorld = worldLoroDoc.subscribe((event: { by: string }) => {
    if (isDisposed || isProcessing) return
    if (event.by !== "import" && event.by !== "local") return

    const worldFrontiersAfter = worldLoroDoc.frontiers()
    if (frontiersEqual(lastKnownWorldFrontiers, worldFrontiersAfter)) return

    debug?.(`world subscription: event.by=${event.by}`)

    const worldFrontiersBefore = lastKnownWorldFrontiers
    lastKnownWorldFrontiers = worldFrontiersAfter

    isProcessing = true
    try {
      filterWorldToWorldview(worldFrontiersBefore, worldFrontiersAfter)
      // Update worldview frontiers after filtering
      lastKnownWorldviewFrontiers = worldviewLoroDoc.frontiers()
    } finally {
      isProcessing = false
      // Process any queued changes after filtering completes
      processQueue()
    }
  })

  // ============================================
  // PROPAGATION: Worldview → World
  // ============================================

  /**
   * Apply a single change and propagate to world.
   *
   * Key insight: Capture frontiers FRESH at the moment of each change.
   * This eliminates stale frontier bugs in re-entrant scenarios.
   */
  function applyAndPropagate(
    fn: (draft: Mutable<D>) => void,
    options?: ChangeOptions,
  ): void {
    debug?.(`applyAndPropagate: starting`)

    // Capture FRESH frontiers at this exact moment
    const frontiersBefore = worldviewLoroDoc.frontiers()

    // Apply change to worldview
    // Use ext().change() directly to avoid TypeScript overload resolution issues
    // with generic type parameters in the change() function
    ext(worldviewDoc).change(fn)

    // Capture FRESH frontiers after change
    const frontiersAfter = worldviewLoroDoc.frontiers()

    // Check if worldview actually changed
    if (frontiersEqual(frontiersBefore, frontiersAfter)) {
      debug?.(`applyAndPropagate: no-op (frontiers unchanged)`)
      return
    }

    // Compute diff for THIS change only (not stale accumulated diff)
    const diff = worldviewLoroDoc.diff(frontiersBefore, frontiersAfter, false)
    worldLoroDoc.applyDiff(diff)

    // Handle commit message
    const serializedMessage = serializeCommitMessage(options?.commitMessage)
    if (serializedMessage) {
      worldLoroDoc.setNextCommitMessage(serializedMessage)
      // Store in WeakMap for parent lens to pick up (for chained lenses)
      // Key is worldLoroDoc because parent's worldviewLoroDoc === child's worldLoroDoc
      pendingMessages.set(worldLoroDoc, serializedMessage)
      debug?.(`applyAndPropagate: with message=${serializedMessage}`)
    }
    worldLoroDoc.commit()

    // Update both frontier trackers
    lastKnownWorldFrontiers = worldLoroDoc.frontiers()
    lastKnownWorldviewFrontiers = frontiersAfter
    debug?.(`applyAndPropagate: completed`)
  }

  /**
   * Process queued changes.
   * Called after any operation completes to drain the queue.
   */
  function processQueue(): void {
    if (changeQueue.length > 0) {
      debug?.(`processQueue: ${changeQueue.length} queued changes`)
    }
    while (changeQueue.length > 0 && !isProcessing) {
      const queued = changeQueue.shift()
      if (!queued) break
      debug?.(`processQueue: processing queued change`)
      isProcessing = true
      try {
        applyAndPropagate(queued.fn, queued.options)
      } finally {
        isProcessing = false
      }
    }
  }

  // Subscribe to worldview for changes from chained lenses
  const unsubscribeWorldview = worldviewLoroDoc.subscribe(
    (event: { by: string }) => {
      if (isDisposed || isProcessing) return
      if (event.by !== "local") return

      // A chained lens applied diff to our worldview
      // Propagate to our world
      debug?.(`worldview subscription: chained lens change detected`)

      isProcessing = true
      try {
        // Capture fresh worldview frontiers for this propagation
        const worldviewFrontiers = worldviewLoroDoc.frontiers()

        // Get diff using worldview's own frontier history (not world's frontiers)
        // This is necessary because worldview has a different peerId than world,
        // so world's frontier IDs may not exist in worldview's history
        const diff = worldviewLoroDoc.diff(
          lastKnownWorldviewFrontiers,
          worldviewFrontiers,
          false,
        )
        worldLoroDoc.applyDiff(diff)

        // Pick up commit message from child lens (if any)
        // Child lens stored it in WeakMap keyed by its worldLoroDoc (our worldviewLoroDoc)
        const childMessage = pendingMessages.get(worldviewLoroDoc)
        if (childMessage) {
          worldLoroDoc.setNextCommitMessage(childMessage)
          pendingMessages.delete(worldviewLoroDoc)
          // Store for our parent lens (if we're also a child in a chain)
          pendingMessages.set(worldLoroDoc, childMessage)
          debug?.(`worldview subscription: propagating child message`)
        }
        worldLoroDoc.commit()

        // Update both frontier trackers
        lastKnownWorldFrontiers = worldLoroDoc.frontiers()
        lastKnownWorldviewFrontiers = worldviewFrontiers
        debug?.(`worldview subscription: propagated to world`)
      } finally {
        isProcessing = false
        processQueue()
      }
    },
  )

  // ============================================
  // CHANGE PROCESSING: Queue + Re-entrancy
  // ============================================

  /**
   * Process local change: worldview → applyDiff → world
   *
   * Re-entrancy is handled via queuing: if called while already processing,
   * the change is queued and processed after the current operation completes.
   *
   * @param fn - Mutation function that modifies the draft
   * @param options - Optional configuration including commit message
   */
  function processLocalChange(
    fn: (draft: Mutable<D>) => void,
    options?: ChangeOptions,
  ): void {
    if (isDisposed) {
      debug?.(`processLocalChange: ignored (disposed)`)
      return
    }

    // Queue if already processing (re-entrant call from subscription)
    if (isProcessing) {
      debug?.(`processLocalChange: queued (re-entrant)`)
      changeQueue.push({ fn, options })
      return
    }

    debug?.(`processLocalChange: starting`)
    isProcessing = true
    try {
      // Process this change atomically
      applyAndPropagate(fn, options)
    } finally {
      isProcessing = false
      // Process any queued changes
      processQueue()
    }
  }

  // ============================================
  // LENS OBJECT
  // ============================================

  const lens: Lens<D> & {
    [EXT_SYMBOL]: { change: typeof processLocalChange }
  } = {
    get worldview() {
      return worldviewDoc
    },
    get world() {
      return world
    },
    dispose() {
      if (!isDisposed) {
        debug?.(`dispose: cleaning up`)
        isDisposed = true
        unsubscribeWorld()
        unsubscribeWorldview()
      }
    },
    [EXT_SYMBOL]: {
      change: processLocalChange,
    },
  }

  return lens
}
