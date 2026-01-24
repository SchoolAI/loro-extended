import type { DocShape, Frontiers, TypedDoc } from "@loro-extended/change"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Generic Reactor Types
// ═══════════════════════════════════════════════════════════════════════════
//
// Reactors are the unified pattern for responding to state transitions.
// They receive { before, after } and can:
//   - Return UI (view reactor)
//   - Call dispatch (message reactor)
//   - Perform async I/O and write to sensors (effect reactor)
//   - Do nothing (observation reactor)
//
// Key insight: Everything is a reactor. Views, subscriptions, and effects
// are all the same pattern.
//
// OPTIMIZATION: Transitions use TypedDoc (lazy proxy) instead of plain
// JSON. This avoids O(N) toJSON() serialization on every document change.
// Values are only evaluated when reactors access them.
//
// IMPORTANT: The before and after TypedDocs are forks at specific frontiers.
// They are read-only snapshots - do not mutate them. Effect reactors that
// need to write should receive the doc separately via factory closure.

/**
 * Dispatch function type - sends messages to the runtime.
 */
export type Dispatch<Msg> = (msg: Msg) => void

/**
 * A state transition with lazy TypedDoc proxies.
 *
 * - `before`: TypedDoc fork at the previous frontier (read-only)
 * - `after`: TypedDoc fork at the current frontier (read-only)
 *
 * Values are lazily evaluated - no toJSON() until you access a property.
 */
export type Transition<Schema extends DocShape> = {
  before: TypedDoc<Schema>
  after: TypedDoc<Schema>
}

/**
 * A reactor function that responds to state transitions.
 *
 * Reactors can:
 * - Dispatch new messages (via the dispatch parameter)
 * - Perform side effects (async I/O, DOM updates, etc.)
 * - Return void or a Promise<void>
 *
 * @param transition The before/after state transition
 * @param dispatch Function to dispatch new messages
 */
export type Reactor<Schema extends DocShape, Msg> = (
  transition: Transition<Schema>,
  dispatch: Dispatch<Msg>,
) => void | Promise<void>

/**
 * A reactor with an associated cleanup function.
 *
 * Use this for reactors that manage resources (timers, subscriptions, etc.)
 * that need to be cleaned up when the runtime is disposed.
 */
export type ReactorWithCleanup<Schema extends DocShape, Msg> = {
  reactor: Reactor<Schema, Msg>
  cleanup: () => void
}

/**
 * Update function type.
 *
 * Conceptually: `(frontier, msg) → frontier'`
 *
 * The runtime binds the document internally. Users write update handlers
 * via `createUpdate()` which provides a working document for reading
 * guards and writing changes.
 *
 * @example
 * ```typescript
 * const update = createUpdate<Schema, Msg>((doc, msg) => {
 *   if (doc.status !== "idle") return  // Guard
 *   change(doc, d => { d.status = "running" })
 * })
 * ```
 */
export type UpdateFn<Schema extends DocShape, Msg> = (
  doc: TypedDoc<Schema>,
  frontier: Frontiers,
  msg: Msg,
) => Frontiers

/**
 * Program configuration for the LEA runtime.
 *
 * @param doc The main CRDT document
 * @param update The update function (see UpdateFn)
 * @param reactors Array of reactors to invoke on state transitions
 * @param historyDoc Optional history document for time travel debugging
 * @param done Optional callback when runtime is disposed
 */
export type Program<Schema extends DocShape, Msg> = {
  doc: TypedDoc<Schema>
  update: UpdateFn<Schema, Msg>
  reactors: Reactor<Schema, Msg>[]
  historyDoc?: TypedDoc<DocShape>
  done?: (frontier: Frontiers) => void
}
