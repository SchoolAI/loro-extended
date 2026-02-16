/**
 * Symbols used by PlainValueRef for internal property access.
 * These symbols allow storing metadata on PlainValueRef objects
 * without conflicting with user data properties.
 *
 * @module plain-value-ref/symbols
 */

/**
 * Symbol to identify PlainValueRef objects.
 * Used by isPlainValueRef() type guard.
 */
export const PLAIN_VALUE_REF_SYMBOL = Symbol.for(
  "loro-extended:plain-value-ref",
)

/**
 * Symbol to store the parent ref's internals.
 * This allows PlainValueRef to read/write through the parent container.
 */
export const PARENT_INTERNALS_SYMBOL = Symbol.for(
  "loro-extended:parent-internals",
)

/**
 * Symbol to store the path from the parent container to this value.
 * Path is relative to the parent's LoroMap, e.g., ["nested", "value"].
 */
export const PATH_SYMBOL = Symbol.for("loro-extended:path")

/**
 * Symbol to store the value shape for this PlainValueRef.
 * Used for nested struct value shapes to enable property access.
 */
export const SHAPE_SYMBOL = Symbol.for("loro-extended:shape")
