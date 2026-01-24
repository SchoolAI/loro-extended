import type { TypedDoc } from "@loro-extended/change"
import type {
  Dispatch as GenericDispatch,
  Reactor as GenericReactor,
  Transition as GenericTransition,
} from "@loro-extended/lea"
import type { QuizMsg } from "./messages.js"
import type { QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Reactor Types (Quiz-Specific)
// ═══════════════════════════════════════════════════════════════════════════
//
// This file re-exports generic LEA types with quiz-specific type parameters.
// The generic types come from @loro-extended/lea.

/**
 * Quiz-specific dispatch function type.
 */
export type Dispatch = GenericDispatch<QuizMsg>

/**
 * Quiz-specific state transition type.
 */
export type Transition = GenericTransition<typeof QuizDocSchema>

/**
 * Quiz-specific reactor type.
 */
export type Reactor = GenericReactor<typeof QuizDocSchema, QuizMsg>

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
 *
 * This is a quiz-specific wrapper around the generic `entered` helper.
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
 *
 * This is a quiz-specific wrapper around the generic `exited` helper.
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
