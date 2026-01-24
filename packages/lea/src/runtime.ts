import {
  type DocShape,
  type Frontiers,
  loro,
  type TypedDoc,
} from "@loro-extended/change"
import type { LoroEventBatch } from "loro-crdt"
import type { HistoryDocSchema } from "./history.js"
import type { Dispatch, Program, Transition } from "./reactor-types.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Runtime
// ═══════════════════════════════════════════════════════════════════════════
//
// The runtime is the "imperative shell" that:
// 1. Manages the current frontier
// 2. Dispatches messages through the update function
// 3. Invokes reactors on state transitions
// 4. Subscribes to external document changes
//
// This is the ONLY impure part of LEA. Everything else is pure functions.
//
// OPTIMIZATION: Instead of calling toJSON() on every document change,
// we store frontiers and create lazy TypedDoc forks on demand.
// This avoids O(N) serialization - values are only evaluated when accessed.

export type Disposer = () => void

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a LEA runtime for the given program.
 *
 * The runtime:
 * - Manages the current frontier
 * - Dispatches messages through the update function
 * - Invokes reactors on state transitions
 * - Subscribes to document changes (local and remote)
 *
 * @param program The program configuration
 * @returns An object with dispatch and dispose functions
 *
 * @example
 * ```typescript
 * const { dispatch, dispose } = createRuntime({
 *   doc: myDoc,
 *   update: myUpdate,
 *   reactors: [timerReactor, sensorReactor],
 * })
 *
 * // Dispatch messages
 * dispatch({ type: "START" })
 *
 * // Clean up when done
 * dispose()
 * ```
 */
export function createRuntime<Schema extends DocShape, Msg>(
  program: Program<Schema, Msg>,
): {
  dispatch: Dispatch<Msg>
  dispose: Disposer
} {
  const { doc, update, reactors, historyDoc, done } = program

  let isRunning = true
  // Store frontier instead of JSON - lazy evaluation!
  let previousFrontier: Frontiers = loro(doc).doc.frontiers()

  // ═══════════════════════════════════════════════════════════════════════
  // Append History Entry
  // ═══════════════════════════════════════════════════════════════════════
  // If a history document is provided, append entries to it on each dispatch.
  // The history document is NEVER checked out, ensuring subscriptions always
  // fire when new entries arrive from peers.

  function appendHistoryEntry(msg: Msg, timestamp: number): void {
    if (!historyDoc) return

    const typedHistoryDoc = historyDoc as TypedDoc<typeof HistoryDocSchema>
    typedHistoryDoc.change(draft => {
      draft.entries.push({
        id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
        msgType: (msg as { type?: string }).type ?? "unknown",
        msgJson: JSON.stringify(msg),
        timestamp,
      })
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Invoke Reactors
  // ═══════════════════════════════════════════════════════════════════════

  function invokeReactors(transition: Transition<Schema>): void {
    for (const reactor of reactors) {
      try {
        const result = reactor(transition, dispatch)
        if (result instanceof Promise) {
          result.catch(error => {
            console.error("Reactor error:", error)
          })
        }
      } catch (error) {
        console.error("Reactor error:", error)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dispatch Function
  // ═══════════════════════════════════════════════════════════════════════
  // Dispatch only writes to the document. Reactors are invoked by the
  // document subscription - this is the "purest" LEA 3 approach where
  // the document change is the single source of truth for reactor invocation.
  //
  // HISTORY: Each dispatch stores the message as a commit annotation,
  // enabling time travel debugging via getMessageHistory().

  function dispatch(msg: Msg): void {
    if (!isRunning) return

    const frontier = loro(doc).doc.frontiers()
    const timestamp = Date.now()

    // Store the message as a commit annotation for history tracking
    // This enables time travel debugging - see getMessageHistory()
    loro(doc).doc.setNextCommitMessage(
      JSON.stringify({
        type: (msg as { type?: string }).type,
        msg,
        timestamp,
      }),
    )

    // Apply the update - this triggers the document subscription
    update(doc, frontier, msg)

    // Append to history document if provided
    // This is separate from the app document and is NEVER checked out,
    // ensuring the history panel always receives updates from peers
    appendHistoryEntry(msg, timestamp)

    // NO reactor invocation here - let the subscription handle it
    // This ensures reactors fire exactly once per state change,
    // whether the change is local or from a remote peer.
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Subscribe to Document Changes
  // ═══════════════════════════════════════════════════════════════════════
  // This is the SINGLE path for reactor invocation. Both local dispatches
  // and remote peer changes flow through here.
  //
  // OPTIMIZATION: We create lazy TypedDoc forks instead of calling toJSON().
  // The forks are snapshots at specific frontiers - values are only
  // evaluated when reactors access them.
  //
  // NOTE: Checkout events are skipped because they represent time travel
  // operations that don't need reactor invocation - the UI will re-render
  // based on the new state via useDoc's frontier-based version key.

  const unsubDoc = loro(doc).subscribe(rawEvent => {
    if (!isRunning) return

    // Cast to LoroEventBatch to access the `by` property
    const event = rawEvent as LoroEventBatch

    // Skip checkout events - they represent time travel operations
    // that don't need reactor invocation
    if (event.by === "checkout") {
      previousFrontier = loro(doc).doc.frontiers()
      return
    }

    const beforeFrontier = previousFrontier
    const afterFrontier = loro(doc).doc.frontiers()

    // Update previous frontier
    previousFrontier = afterFrontier

    // Create lazy TypedDoc forks at the captured frontiers
    // These are read-only snapshots - no toJSON() until values are accessed
    const before = doc.forkAt(beforeFrontier)
    const after = doc.forkAt(afterFrontier)

    invokeReactors({ before, after })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Dispose Function
  // ═══════════════════════════════════════════════════════════════════════

  function dispose(): void {
    if (isRunning) {
      isRunning = false
      unsubDoc()
      if (done) {
        done(loro(doc).doc.frontiers())
      }
    }
  }

  return { dispatch, dispose }
}
