import {
  type DocShape,
  type Frontiers,
  loro,
  replayDiff,
  shallowForkAt,
  type TypedDoc,
} from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Update Function Factory
// ═══════════════════════════════════════════════════════════════════════════
//
// The update function is the heart of LEA. It:
// 1. Receives the current frontier and a message
// 2. Derives state from the frontier
// 3. Applies the state machine transition
// 4. Returns the new frontier
//
// Key insight: This is deterministic. Same frontier + same message = same result.

// ═══════════════════════════════════════════════════════════════════════════
// Timestamp from Frontier
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a monotonically increasing timestamp from a frontier.
 *
 * This is useful for generating unique IDs or ordering events.
 * The timestamp increases with each operation in the document.
 */
export function getTimestampFromFrontier(frontier: Frontiers): number {
  return frontier.reduce((sum, f) => sum + f.counter + 1, 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// createUpdate - Fork-and-Merge Update Factory
// ═══════════════════════════════════════════════════════════════════════════
//
// Creates an update function with fork-and-merge semantics.
//
// The handler receives a mutable doc (actually a shallow fork at the frontier).
// Read from it for guards, mutate it for changes. The fork-and-merge
// is handled automatically - the user just thinks of it as "the doc".
//
// Benefits:
// - Single object for both reading and writing (no state/write confusion)
// - Impossible to accidentally read from wrong source
// - Natural mental model: "work on the doc, changes get applied"
//
// OPTIMIZATION: Uses shallowForkAt instead of forkAt for memory efficiency.
// Shallow forks only contain current state, not full history - perfect for
// the fork-and-merge pattern where we only need to read state and apply changes.

/**
 * Creates an update function with fork-and-merge semantics.
 *
 * The handler receives a working document (a shallow fork at the frontier).
 * Read from it for guards, mutate it via change(). Changes are automatically
 * merged back to the main document.
 *
 * @param handler Function that reads/writes to the working document
 * @returns An update function: (doc, frontier, msg) → frontier'
 *
 * @example
 * ```typescript
 * const update = createUpdate<MySchema, MyMsg>((doc, msg, timestamp) => {
 *   // Read current state
 *   if (doc.state.status !== "idle") return
 *
 *   // Write new state
 *   change(doc, draft => {
 *     draft.state.status = "running"
 *     draft.state.startedAt = timestamp
 *   })
 * })
 * ```
 */
export function createUpdate<Schema extends DocShape, Msg>(
  handler: (doc: TypedDoc<Schema>, msg: Msg, timestamp: number) => void,
): (doc: TypedDoc<Schema>, frontier: Frontiers, msg: Msg) => Frontiers {
  return (doc, frontier, msg) => {
    // 1. Create a shallow fork at the frontier - memory efficient!
    // Uses shallowForkAt with preservePeerId: true so operations appear
    // to come from the same peer, maintaining consistent frontier progression.
    const workingDoc = shallowForkAt(doc, frontier, { preservePeerId: true })

    // 2. Compute timestamp from frontier
    const timestamp = getTimestampFromFrontier(frontier)

    // 3. Capture frontier before handler execution
    const beforeFrontier = loro(workingDoc).doc.frontiers()

    // 4. Let handler read/write to the working doc
    handler(workingDoc, msg, timestamp)

    // 5. Get frontier after handler execution
    const afterFrontier = loro(workingDoc).doc.frontiers()

    // 6. Merge changes back into main doc using diff-replay
    // This creates LOCAL events (not import events), which:
    // - Are captured by subscribeLocalUpdates() for synchronization
    // - Are recorded by UndoManager for undo/redo support
    const diff = loro(workingDoc).doc.diff(beforeFrontier, afterFrontier, false)
    if (diff.length > 0) {
      replayDiff(loro(doc).doc, diff)
      // Commit to trigger subscriptions (subscribe() and subscribeLocalUpdates())
      loro(doc).doc.commit()
    }

    return loro(doc).doc.frontiers()
  }
}
