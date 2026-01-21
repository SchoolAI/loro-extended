import { type Frontiers, loro, type TypedDoc } from "@loro-extended/change"
import type { QuizMsg } from "./messages.js"
import type { Reactor, Transition } from "./reactor-types.js"
import type { Question, QuizDocSchema } from "./schema.js"
import { update } from "./update.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Runtime
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

export type Dispatch = (msg: QuizMsg) => void
export type Disposer = () => void

export type Program = {
  doc: TypedDoc<typeof QuizDocSchema>
  questions: Question[]
  reactors: Reactor[]
  done?: (frontier: Frontiers) => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Function
// ═══════════════════════════════════════════════════════════════════════════

export function runtime(program: Program): {
  dispatch: Dispatch
  dispose: Disposer
} {
  const { doc, questions, reactors, done } = program

  let isRunning = true
  // Store frontier instead of JSON - lazy evaluation!
  let previousFrontier: Frontiers = loro(doc).doc.frontiers()

  // ═══════════════════════════════════════════════════════════════════════
  // Invoke Reactors
  // ═══════════════════════════════════════════════════════════════════════

  function invokeReactors(transition: Transition): void {
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

  function dispatch(msg: QuizMsg): void {
    if (!isRunning) return

    const frontier = loro(doc).doc.frontiers()

    // Apply the update - this triggers the document subscription
    update(doc, frontier, msg, questions)

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

  const unsubDoc = loro(doc).subscribe(() => {
    if (!isRunning) return

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
