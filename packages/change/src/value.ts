/**
 * The value() function for unwrapping PlainValueRef, TypedRef, and TypedDoc.
 * Provides a consistent way to get the current plain value from any reactive wrapper.
 *
 * Also exports the `unwrap` helper for conditionally unwrapping PlainValueRef values.
 *
 * @module value
 */

import { isPlainValueRef, type PlainValueRef } from "./plain-value-ref/index.js"
import type { ContainerShape, DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { Infer } from "./types.js"

/**
 * Unwrap a PlainValueRef to get its current plain value.
 *
 * @param ref - A PlainValueRef wrapping a plain value
 * @returns The current plain value
 *
 * @example
 * ```typescript
 * const title = doc.meta.title // PlainValueRef<string>
 * const titleValue = value(title) // string
 * ```
 */
export function value<T>(ref: PlainValueRef<T>): T

/**
 * Unwrap a TypedRef to get its current plain value (via toJSON).
 *
 * @param ref - A TypedRef (StructRef, ListRef, etc.)
 * @returns The current plain value from toJSON()
 *
 * @example
 * ```typescript
 * const config = doc.config // StructRef<...>
 * const configValue = value(config) // { ... }
 * ```
 */
export function value<S extends ContainerShape>(ref: TypedRef<S>): Infer<S>

/**
 * Unwrap a TypedDoc to get its current plain value (via toJSON).
 *
 * @param doc - A TypedDoc
 * @returns The current plain value from toJSON()
 *
 * @example
 * ```typescript
 * const docValue = value(doc) // { meta: { ... }, ... }
 * ```
 */
export function value<D extends DocShape>(doc: TypedDoc<D>): Infer<D>

/**
 * Implementation of value() - dispatches based on type.
 */
export function value(
  target: PlainValueRef<unknown> | TypedRef<any> | TypedDoc<any>,
): unknown {
  // PlainValueRef: call valueOf()
  if (isPlainValueRef(target)) {
    return target.valueOf()
  }

  // TypedRef and TypedDoc: call toJSON()
  if (target && typeof target === "object" && "toJSON" in target) {
    return (target as { toJSON(): unknown }).toJSON()
  }

  throw new Error(
    "value() requires a PlainValueRef, TypedRef, or TypedDoc. " +
      "Make sure you're passing a valid reactive wrapper.",
  )
}

/**
 * Unwrap a value that may be a PlainValueRef.
 * If the value is a PlainValueRef, returns its current value via valueOf().
 * Otherwise, returns the value as-is.
 *
 * This is useful for writing code that works with both raw values and PlainValueRef
 * without needing to know which type you have.
 *
 * @param v - The value to potentially unwrap
 * @returns The unwrapped value
 *
 * @example
 * ```typescript
 * const title = doc.meta.title // PlainValueRef<string>
 * const rawTitle = unwrap(title) // string
 *
 * const num = 42
 * const rawNum = unwrap(num) // 42 (unchanged)
 * ```
 */
export const unwrap = <T>(v: T): T extends { valueOf(): infer U } ? U : T =>
  (isPlainValueRef(v) ? value(v) : v) as any
