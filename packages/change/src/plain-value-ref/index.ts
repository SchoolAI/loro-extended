/**
 * PlainValueRef module - Reactive subscriptions for plain values.
 *
 * This module provides PlainValueRef, a unified read-write accessor for
 * plain values (strings, numbers, booleans, etc.) stored in CRDT containers.
 *
 * @module plain-value-ref
 */

// Re-export factory
export { createListItemPlainValueRef, createPlainValueRef } from "./factory.js"

// Re-export symbols (for internal use by other modules)
export {
  PARENT_INTERNALS_SYMBOL,
  PATH_SYMBOL,
  PLAIN_VALUE_REF_SYMBOL,
  SHAPE_SYMBOL,
} from "./symbols.js"
// Re-export types
export type { PlainValueRef } from "./types.js"

// Re-export value reader functions (for testing and advanced use)
export {
  getContainerValue,
  getListContainerValue,
  getListOverlayValue,
  getOverlayValue,
  getPlaceholderValue,
  resolveListValue,
  resolveValue,
} from "./value-reader.js"

// Re-export value writer functions (for testing and advanced use)
export { writeListValue, writeValue } from "./value-writer.js"

import type { BaseRefInternals } from "../typed-refs/base.js"
// Import symbols for type guard
import {
  PARENT_INTERNALS_SYMBOL,
  PATH_SYMBOL,
  PLAIN_VALUE_REF_SYMBOL,
} from "./symbols.js"
import type { PlainValueRef } from "./types.js"

/**
 * Type guard to check if a value is a PlainValueRef.
 *
 * @param value - The value to check
 * @returns True if the value is a PlainValueRef
 *
 * @example
 * ```typescript
 * const title = doc.meta.title // PlainValueRef<string>
 * if (isPlainValueRef(title)) {
 *   console.log(title.valueOf())
 * }
 * ```
 */
export function isPlainValueRef<T = unknown>(
  value: unknown,
): value is PlainValueRef<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    PLAIN_VALUE_REF_SYMBOL in value &&
    (value as any)[PLAIN_VALUE_REF_SYMBOL] === true
  )
}

/**
 * Get the parent internals from a PlainValueRef.
 * This is an internal helper for subscribe() and other functions that need
 * to access the underlying container.
 *
 * @internal
 * @param ref - The PlainValueRef
 * @returns The parent ref's internals
 */
export function getPlainValueRefParentInternals(
  ref: PlainValueRef<unknown>,
): BaseRefInternals<any> {
  return ref[PARENT_INTERNALS_SYMBOL]
}

/**
 * Get the path from a PlainValueRef.
 * This is an internal helper for subscribe() and other functions that need
 * to know the path to the value.
 *
 * @internal
 * @param ref - The PlainValueRef
 * @returns The path from the parent container to this value
 */
export function getPlainValueRefPath(ref: PlainValueRef<unknown>): string[] {
  return ref[PATH_SYMBOL]
}
