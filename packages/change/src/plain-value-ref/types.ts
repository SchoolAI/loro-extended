/**
 * Type definitions for PlainValueRef.
 * Separated from index.ts to avoid circular dependencies with factory.ts.
 *
 * @module plain-value-ref/types
 */

import type { ValueShape } from "../shape.js"
import type { BaseRefInternals } from "../typed-refs/base.js"
import {
  PARENT_INTERNALS_SYMBOL,
  PATH_SYMBOL,
  PLAIN_VALUE_REF_SYMBOL,
  SHAPE_SYMBOL,
} from "./symbols.js"

/**
 * PlainValueRef is a read-write accessor for plain values stored in CRDT containers.
 *
 * It provides:
 * - Reactive reads via `get()` (reads from overlay → container → placeholder)
 * - Eager writes via `set()` (immediately persists to Loro)
 * - Coercion support via `valueOf()`, `toString()`, `[Symbol.toPrimitive]()`
 * - Nested struct access via Proxy GET trap (typed via DeepPlainValueRef)
 *
 * NOTE: PlainValueRef must NOT be added to AnyTypedRef.
 * AnyTypedRef uses ReturnType<R["toJSON"]> for inference;
 * PlainValueRef<any>["toJSON"] returns `any`, destroying inference.
 * Use a separate, higher-priority overload in useValue() instead.
 *
 * NOTE: PlainValueRef must NOT be accepted by loro(), ext(), or change().
 * These are container-level operations. Attempting to pass PlainValueRef
 * should result in a type error, guiding users to use value() instead.
 *
 * @template T - The plain value type (string, number, boolean, or nested struct)
 */
export interface PlainValueRef<T> {
  /**
   * Brand symbol to identify PlainValueRef objects.
   * Used by isPlainValueRef() type guard.
   */
  readonly [PLAIN_VALUE_REF_SYMBOL]: true

  /**
   * @internal
   * The parent ref's internals. Provides access to container, overlay, placeholder.
   */
  readonly [PARENT_INTERNALS_SYMBOL]: BaseRefInternals<any>

  /**
   * @internal
   * The path from the parent container to this value.
   * E.g., ["nested", "deep", "inner"] for doc.meta.nested.deep.inner
   */
  readonly [PATH_SYMBOL]: string[]

  /**
   * @internal
   * The value shape for this PlainValueRef.
   * Used for nested struct property access.
   */
  readonly [SHAPE_SYMBOL]: ValueShape

  /**
   * Returns the current value. Used for coercion in expressions.
   *
   * @example
   * ```typescript
   * const title = doc.meta.title // PlainValueRef<string>
   * const str = `Title: ${title}` // Calls valueOf() implicitly
   * ```
   */
  valueOf(): T

  /**
   * Returns a string representation of the value.
   */
  toString(): string

  /**
   * Returns the current value for JSON serialization.
   * This enables `JSON.stringify(plainValueRef)` to work correctly.
   */
  toJSON(): T

  /**
   * Custom primitive coercion for template literals and operators.
   *
   * @param hint - The type hint ("string", "number", or "default")
   */
  [Symbol.toPrimitive](hint: string): T | string | number

  /**
   * Returns the current plain value.
   * This is the canonical way to read from a PlainValueRef.
   *
   * @example
   * ```typescript
   * const title = doc.meta.title.get() // string
   * const nested = doc.meta.config.get() // { theme: string, ... }
   * ```
   */
  get(): T

  /**
   * Sets the value, immediately persisting to the CRDT container.
   * This is the canonical way to write to a PlainValueRef.
   *
   * @param value - The new value to set
   *
   * @example
   * ```typescript
   * doc.meta.title.set("New Title")
   * draft.config.theme.set("dark")
   * ```
   */
  set(value: T): void
}

/**
 * A PlainValueRef with nested property access for object types.
 *
 * When T is a plain object, this type exposes each key as a nested
 * DeepPlainValueRef, matching the runtime Proxy behavior where
 * accessing a property on a struct-valued PlainValueRef returns
 * a nested PlainValueRef for that property.
 *
 * For primitives, arrays, and non-plain-object types, this is identical
 * to PlainValueRef<T>.
 *
 * This type is used in StructValueShape, RecordValueShape, etc. to
 * provide type-safe nested access. It is NOT used in PlainValueRef itself
 * to avoid circular type references in the shape system.
 *
 * @example
 * ```typescript
 * // Given a struct value shape:
 * const metadata: DeepPlainValueRef<{ author: string; published: boolean }>
 *
 * // Nested access is typed:
 * metadata.author        // DeepPlainValueRef<string> (which is PlainValueRef<string>)
 * metadata.author.get()  // string
 * metadata.author.set("Alice")
 * metadata.get()         // { author: string; published: boolean }
 * ```
 */
export type DeepPlainValueRef<T> = PlainValueRef<T> &
  (T extends any[] | Uint8Array | string | number | boolean | null | undefined
    ? {}
    : T extends Record<string, any>
      ? { readonly [K in keyof T]: DeepPlainValueRef<T[K]> }
      : {})
