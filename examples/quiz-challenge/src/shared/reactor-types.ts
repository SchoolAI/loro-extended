import type { TypedDoc } from "@loro-extended/change"
import type { QuizMsg } from "./messages.js"
import type { QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Reactor Types (Shared)
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
// OPTIMIZATION: Transitions now use TypedDoc (lazy proxy) instead of plain
// JSON. This avoids O(N) toJSON() serialization on every document change.
// Values are only evaluated when reactors access them.
//
// IMPORTANT: The before and after TypedDocs are forks at specific frontiers.
// They are read-only snapshots - do not mutate them. Effect reactors that
// need to write should receive the doc separately via factory closure.

export type Dispatch = (msg: QuizMsg) => void

/**
 * A state transition with lazy TypedDoc proxies.
 *
 * - `before`: TypedDoc fork at the previous frontier (read-only)
 * - `after`: TypedDoc fork at the current frontier (read-only)
 *
 * Values are lazily evaluated - no toJSON() until you access a property.
 */
export type Transition = {
  before: TypedDoc<typeof QuizDocSchema>
  after: TypedDoc<typeof QuizDocSchema>
}

// ═══════════════════════════════════════════════════════════════════════════
// Reactor Type
// ═══════════════════════════════════════════════════════════════════════════

export type Reactor = (
  transition: Transition,
  dispatch: Dispatch,
) => void | Promise<void>

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Detect state transitions
// ═══════════════════════════════════════════════════════════════════════════

/** Valid quiz status values */
export type QuizStatus =
  | "idle"
  | "answering"
  | "submitted"
  | "reviewing"
  | "complete"

/**
 * Detects when the quiz enters a specific status.
 * Works with TypedDoc proxies - accesses status lazily.
 */
export function entered(
  status: QuizStatus,
  before: TypedDoc<typeof QuizDocSchema>,
  after: TypedDoc<typeof QuizDocSchema>,
): boolean {
  return (
    before.quiz.state.status !== status && after.quiz.state.status === status
  )
}

/**
 * Detects when the quiz exits a specific status.
 * Works with TypedDoc proxies - accesses status lazily.
 */
export function exited(
  status: QuizStatus,
  before: TypedDoc<typeof QuizDocSchema>,
  after: TypedDoc<typeof QuizDocSchema>,
): boolean {
  return (
    before.quiz.state.status === status && after.quiz.state.status !== status
  )
}
