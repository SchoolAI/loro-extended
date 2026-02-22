/**
 * The value() function for extracting plain values from reactive wrappers.
 *
 * `value()` is polymorphic — it accepts any input:
 * - PlainValueRef<T> → unwraps via valueOf()
 * - TypedRef (StructRef, ListRef, etc.) → extracts via toJSON()
 * - TypedDoc → extracts via toJSON()
 * - null / undefined → passes through unchanged
 * - Any other value → passes through unchanged (already plain)
 *
 * @module value
 */

import { isPlainValueRef, type PlainValueRef } from "./plain-value-ref/index.js"
import type { ContainerShape, DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { Infer } from "./types.js"

// Well-known symbols for identifying loro-extended objects
const LORO_SYMBOL = Symbol.for("loro-extended:loro")
const EXT_SYMBOL = Symbol.for("loro-extended:ext")

// ============================================================================
// Specific overloads (checked first — provide precise return types)
// ============================================================================

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

// ============================================================================
// Nullish overloads (less specific — must come AFTER non-nullish)
// ============================================================================

/** Handle undefined input — returns undefined. */
export function value(ref: undefined): undefined

/** Handle null input — returns null. */
export function value(ref: null): null

/**
 * Unwrap a PlainValueRef that may be undefined.
 * Enables patterns like `value(record.get("key")?.prop)`.
 */
export function value<T>(ref: PlainValueRef<T> | undefined): T | undefined

/**
 * Unwrap a PlainValueRef that may be null.
 */
export function value<T>(ref: PlainValueRef<T> | null): T | null

/**
 * Unwrap a TypedRef that may be undefined.
 */
export function value<S extends ContainerShape>(
  ref: TypedRef<S> | undefined,
): Infer<S> | undefined

/**
 * Unwrap a TypedRef that may be null.
 */
export function value<S extends ContainerShape>(
  ref: TypedRef<S> | null,
): Infer<S> | null

/**
 * Unwrap a TypedDoc that may be undefined.
 */
export function value<D extends DocShape>(
  doc: TypedDoc<D> | undefined,
): Infer<D> | undefined

/**
 * Unwrap a TypedDoc that may be null.
 */
export function value<D extends DocShape>(
  doc: TypedDoc<D> | null,
): Infer<D> | null

// ============================================================================
// Catch-all overload (checked LAST — handles raw values and complex unions)
//
// This is what makes value() polymorphic. It matches any type that the specific
// overloads above miss, including:
//   - StructRef<S, M> | undefined  (concrete ref subclass unions)
//   - number | PlainValueRef<number>  (inside/outside change() unions)
//   - string, number, boolean  (already-plain values)
//
// The return type is T (identity), which is less precise than Infer<S> for refs
// that fall through, but the runtime behavior is correct (toJSON gets called).
// ============================================================================

/**
 * Pass through any value that is not a reactive wrapper.
 * If the value happens to be a PlainValueRef, TypedRef, or TypedDoc at runtime,
 * it will still be correctly unwrapped.
 *
 * @param v - Any value
 * @returns The value unchanged, or unwrapped if it's a reactive wrapper
 */
export function value<T>(v: T): T

// ============================================================================
// Implementation
// ============================================================================

export function value(target: unknown): unknown {
  // Nullish: pass through
  if (target === undefined) return undefined
  if (target === null) return null

  // PlainValueRef: call valueOf()
  if (isPlainValueRef(target)) {
    return target.valueOf()
  }

  // TypedRef and TypedDoc: call toJSON()
  // Use loro symbol checks to avoid accidentally calling toJSON() on
  // arbitrary objects like Date, custom classes, etc.
  if (target && typeof target === "object") {
    if (
      (LORO_SYMBOL in (target as object) || EXT_SYMBOL in (target as object)) &&
      "toJSON" in target
    ) {
      return (target as { toJSON(): unknown }).toJSON()
    }
  }

  // Everything else: pass through (already plain)
  return target
}
