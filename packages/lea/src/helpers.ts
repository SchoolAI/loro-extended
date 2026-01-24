import type { DocShape, TypedDoc } from "@loro-extended/change"
import type { Transition } from "./reactor-types.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 - Transition Helpers
// ═══════════════════════════════════════════════════════════════════════════
//
// These helpers detect state transitions in a type-safe, generic way.
// They work with TypedDoc proxies - values are lazily evaluated.

/**
 * Detects when a value enters a specific state.
 *
 * Returns true if:
 * - The value was NOT equal to `targetValue` before
 * - The value IS equal to `targetValue` after
 *
 * @param selector Function to extract the value from the document
 * @param targetValue The value to check for
 * @param transition The before/after transition
 *
 * @example
 * ```typescript
 * // Check if quiz status entered "answering"
 * if (entered(doc => doc.quiz.state.status, "answering", transition)) {
 *   // Start timer...
 * }
 * ```
 */
export function entered<Schema extends DocShape, T>(
  selector: (doc: TypedDoc<Schema>) => T,
  targetValue: T,
  transition: Transition<Schema>,
): boolean {
  const beforeValue = selector(transition.before)
  const afterValue = selector(transition.after)
  return beforeValue !== targetValue && afterValue === targetValue
}

/**
 * Detects when a value exits a specific state.
 *
 * Returns true if:
 * - The value WAS equal to `targetValue` before
 * - The value is NOT equal to `targetValue` after
 *
 * @param selector Function to extract the value from the document
 * @param targetValue The value to check for
 * @param transition The before/after transition
 *
 * @example
 * ```typescript
 * // Check if quiz status exited "answering"
 * if (exited(doc => doc.quiz.state.status, "answering", transition)) {
 *   // Stop timer...
 * }
 * ```
 */
export function exited<Schema extends DocShape, T>(
  selector: (doc: TypedDoc<Schema>) => T,
  targetValue: T,
  transition: Transition<Schema>,
): boolean {
  const beforeValue = selector(transition.before)
  const afterValue = selector(transition.after)
  return beforeValue === targetValue && afterValue !== targetValue
}

/**
 * Detects when a value has changed (regardless of what it changed to).
 *
 * Returns true if the value before is different from the value after.
 *
 * @param selector Function to extract the value from the document
 * @param transition The before/after transition
 *
 * @example
 * ```typescript
 * // Check if the score changed
 * if (changed(doc => doc.score.value, transition)) {
 *   // Update leaderboard...
 * }
 * ```
 */
export function changed<Schema extends DocShape, T>(
  selector: (doc: TypedDoc<Schema>) => T,
  transition: Transition<Schema>,
): boolean {
  const beforeValue = selector(transition.before)
  const afterValue = selector(transition.after)
  return beforeValue !== afterValue
}

/**
 * Detects when a value transitions from one specific state to another.
 *
 * Returns true if:
 * - The value WAS equal to `fromValue` before
 * - The value IS equal to `toValue` after
 *
 * @param selector Function to extract the value from the document
 * @param fromValue The value before the transition
 * @param toValue The value after the transition
 * @param transition The before/after transition
 *
 * @example
 * ```typescript
 * // Check if status went from "submitted" to "reviewing"
 * if (transitioned(doc => doc.quiz.state.status, "submitted", "reviewing", transition)) {
 *   // Show feedback...
 * }
 * ```
 */
export function transitioned<Schema extends DocShape, T>(
  selector: (doc: TypedDoc<Schema>) => T,
  fromValue: T,
  toValue: T,
  transition: Transition<Schema>,
): boolean {
  const beforeValue = selector(transition.before)
  const afterValue = selector(transition.after)
  return beforeValue === fromValue && afterValue === toValue
}
