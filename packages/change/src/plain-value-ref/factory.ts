/**
 * Factory functions for creating PlainValueRef objects.
 * These functions assemble PlainValueRef with proper Proxy handling for nested structs and records.
 *
 * @module plain-value-ref/factory
 */

import type {
  AnyValueShape,
  RecordValueShape,
  StructValueShape,
  ValueShape,
} from "../shape.js"
import type { BaseRefInternals } from "../typed-refs/base.js"

import {
  PARENT_INTERNALS_SYMBOL,
  PATH_SYMBOL,
  PLAIN_VALUE_REF_SYMBOL,
  SHAPE_SYMBOL,
} from "./symbols.js"
import type { PlainValueRef } from "./types.js"
import { resolveListValue, resolveValue } from "./value-reader.js"
import {
  writeListValue,
  writeListValueAtPath,
  writeValue,
} from "./value-writer.js"

/**
 * Symbol to store the list index for list item PlainValueRefs.
 * This is used instead of PATH_SYMBOL for list items.
 */
export const LIST_INDEX_SYMBOL = Symbol.for("loro-extended:list-index")

/**
 * Synthetic shape used for nested generic object proxies (union/any).
 * These proxies don't have a real shape to recurse into, so we use this constant.
 */
const SYNTHETIC_ANY_SHAPE = {
  _type: "value",
  valueType: "any",
} as AnyValueShape

// ============================================================================
// Proxy Boilerplate Helpers
// ============================================================================

/**
 * Result type for proxyGetPreamble.
 * - `handled: true` means the preamble handled the property access (return `value`)
 * - `handled: false` means the caller should handle the string property `prop`
 */
type PreambleResult =
  | { handled: true; value: unknown }
  | { handled: false; prop: string }

/**
 * GET preamble shared by all proxy handlers.
 * Handles symbol properties and existing properties on the target.
 *
 * @param target - The proxy target
 * @param prop - The property being accessed
 * @param receiver - The proxy receiver
 * @returns PreambleResult indicating whether the access was handled
 */
function proxyGetPreamble(
  target: object,
  prop: string | symbol,
  receiver: unknown,
): PreambleResult {
  if (typeof prop === "symbol" || prop in target) {
    return { handled: true, value: Reflect.get(target, prop, receiver) }
  }
  if (typeof prop === "string") {
    return { handled: false, prop }
  }
  return { handled: true, value: undefined }
}

/**
 * Runtime primitive check for nested values.
 * Returns true if the value is a primitive (should be returned raw, not wrapped).
 * This enables boolean logic like `!draft.completed` and `if (item.active)`.
 *
 * @param value - The nested value to check
 * @returns true if the value is a primitive or null
 */
function runtimePrimitiveCheck(value: unknown): boolean {
  return value === null || typeof value !== "object"
}

/**
 * Build the base PlainValueRef object with all required symbols and methods.
 * This is the shared foundation for all PlainValueRef instances.
 *
 * @param getValue - Function to retrieve the current value
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to this value
 * @param shape - The value shape for this value
 * @param listIndex - Optional list index for list item PlainValueRefs
 * @returns A base PlainValueRef object (not yet proxied)
 */
function buildBasePlainValueRef<T>(
  getValue: () => T,
  internals: BaseRefInternals<any>,
  path: string[],
  shape: ValueShape,
  listIndex?: number,
  listNestedPath?: string[],
): PlainValueRef<T> {
  // Cast needed because nested properties (for object types) are provided
  // by the Proxy at runtime, not by this base object literal.
  const base = {
    [PLAIN_VALUE_REF_SYMBOL]: true as const,
    [PARENT_INTERNALS_SYMBOL]: internals,
    [PATH_SYMBOL]: path,
    [SHAPE_SYMBOL]: shape,
    valueOf: getValue,
    toString: () => String(getValue()),
    toJSON: getValue,
    [Symbol.toPrimitive](hint: string): T | string | number {
      const v = getValue()
      if (hint === "string") return String(v)
      if (hint === "number") return Number(v)
      return v
    },
    get: getValue,
    set(value: T): void {
      if (listIndex !== undefined) {
        if (listNestedPath && listNestedPath.length > 0) {
          // Nested list item property: read-modify-write
          writeListValueAtPath(internals, listIndex, listNestedPath, value)
        } else {
          // Top-level list item: replace the whole value
          writeListValue(internals, listIndex, value)
        }
      } else {
        // Struct/record property: write through the path
        writeValue(internals, path, value)
      }
    },
  } as PlainValueRef<T>

  // Store the numeric index for list-specific operations
  if (listIndex !== undefined) {
    ;(base as any)[LIST_INDEX_SYMBOL] = listIndex
  }

  return base
}

/**
 * Create a PlainValueRef for a value at a given path within a parent container.
 *
 * For struct value shapes, the returned object is wrapped in a Proxy to enable
 * nested property access (e.g., `ref.nested.deep.inner`).
 *
 * @param internals - The parent ref's internals (provides access to container, overlay, placeholder)
 * @param path - Path from the parent container to this value
 * @param shape - The value shape for this value
 * @returns A PlainValueRef that reads/writes through the parent container
 */
export function createPlainValueRef<T>(
  internals: BaseRefInternals<any>,
  path: string[],
  shape: ValueShape,
): PlainValueRef<T> {
  const getValue = (): T => resolveValue<T>(internals, path) as T
  const base = buildBasePlainValueRef(getValue, internals, path, shape)

  // For nested struct value shapes, wrap in Proxy to enable property access
  if (shape.valueType === "struct" && "shape" in shape) {
    return createStructProxy(base, internals, path, shape as StructValueShape)
  }

  // For record value shapes, wrap in Proxy to enable dynamic property access
  if (shape.valueType === "record" && "shape" in shape) {
    return createRecordProxy(base, internals, path, shape as RecordValueShape)
  }

  // For union and any shapes containing objects, wrap in a generic object proxy
  // that enables nested property access via read-modify-write
  if (shape.valueType === "union" || shape.valueType === "any") {
    const currentValue = getValue()
    if (currentValue !== null && typeof currentValue === "object") {
      return createGenericObjectProxy(base, internals, path)
    }
  }

  return base
}

/**
 * Create a Proxy wrapper for struct value shapes that enables nested property access.
 *
 * The Proxy intercepts:
 * - GET: Returns PlainValueRef for nested properties defined in the shape
 *
 * Note: SET is not supported. Use .set() on the nested PlainValueRef instead.
 *
 * @param base - The base PlainValueRef object
 * @param internals - The parent ref's internals
 * @param path - Current path to this struct
 * @param shape - The struct value shape with nested property definitions
 * @returns A Proxy-wrapped PlainValueRef
 */
function createStructProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  path: string[],
  shape: StructValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      if (preamble.prop in shape.shape) {
        return createPlainValueRef(
          internals,
          [...path, preamble.prop],
          shape.shape[preamble.prop],
        )
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

/**
 * Create a Proxy wrapper for union/any value shapes containing objects.
 * Unlike struct proxies (which have a defined shape), this proxy allows
 * dynamic property access based on the actual runtime value structure.
 *
 * Note: SET is not supported. Use .set() on the PlainValueRef instead.
 *
 * @param base - The base PlainValueRef object
 * @param internals - The parent ref's internals
 * @param path - Current path to this value
 * @returns A Proxy-wrapped PlainValueRef
 */
function createGenericObjectProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  path: string[],
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      const currentValue = target.valueOf() as Record<string, unknown>
      if (
        currentValue &&
        typeof currentValue === "object" &&
        preamble.prop in currentValue
      ) {
        // Special case: array .length returns raw number for ergonomics
        // This is a known property of arrays and shouldn't require .get()
        if (Array.isArray(currentValue) && preamble.prop === "length") {
          return currentValue.length
        }

        const propValue = currentValue[preamble.prop]
        if (propValue === undefined) return undefined
        return createNestedGenericObjectProxy(
          internals,
          path,
          [preamble.prop],
          propValue,
        )
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

/**
 * Create a nested proxy for deep property access within union/any shapes.
 */
function createNestedGenericObjectProxy<T>(
  internals: BaseRefInternals<any>,
  rootPath: string[],
  nestedPath: string[],
  currentValue: unknown,
): PlainValueRef<T> {
  const getValue = (): T => {
    const rootValue = resolveValue<Record<string, unknown>>(internals, rootPath)
    if (rootValue === null || typeof rootValue !== "object") {
      return undefined as T
    }
    // Navigate to the nested value
    let current: unknown = rootValue
    for (const key of nestedPath) {
      if (current === null || typeof current !== "object") {
        return undefined as T
      }
      current = (current as Record<string, unknown>)[key]
    }
    return current as T
  }

  const base = buildBasePlainValueRef(
    getValue,
    internals,
    [...rootPath, ...nestedPath],
    SYNTHETIC_ANY_SHAPE,
  )

  // If the current value is an object, wrap in proxy for further nesting
  if (!runtimePrimitiveCheck(currentValue)) {
    return new Proxy(base, {
      get(target, prop, receiver) {
        const preamble = proxyGetPreamble(target, prop, receiver)
        if (preamble.handled) return preamble.value

        const val = target.valueOf() as Record<string, unknown>
        if (val && typeof val === "object" && preamble.prop in val) {
          // Special case: array .length returns raw number for ergonomics
          // This is a known property of arrays and shouldn't require .get()
          if (Array.isArray(val) && preamble.prop === "length") {
            return val.length
          }

          const propValue = val[preamble.prop]
          if (propValue === undefined) return undefined
          return createNestedGenericObjectProxy(
            internals,
            rootPath,
            [...nestedPath, preamble.prop],
            propValue,
          )
        }
        return undefined
      },
    }) as PlainValueRef<T>
  }

  return base
}

/**
 * Create a Proxy wrapper for record value shapes that enables dynamic property access.
 *
 * Unlike struct value shapes with fixed keys, record value shapes have dynamic keys.
 * The Proxy intercepts:
 * - GET: Returns the value at that key from the current record value
 *
 * Note: SET is not supported. Use .set() on the PlainValueRef instead.
 *
 * @param base - The base PlainValueRef object
 * @param internals - The parent ref's internals
 * @param path - Current path to this record
 * @param shape - The record value shape
 * @returns A Proxy-wrapped PlainValueRef
 */
function createRecordProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  path: string[],
  shape: RecordValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      // Always create a PlainValueRef for any key access when shape.shape is defined.
      // This enables .set() on both existing and new keys via read-modify-write.
      if (shape.shape) {
        return createPlainValueRef(
          internals,
          [...path, preamble.prop],
          shape.shape,
        )
      }

      // Fallback for untyped records: return the raw value
      const currentValue = target.valueOf() as Record<string, unknown>
      if (currentValue && typeof currentValue === "object") {
        return currentValue[preamble.prop]
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

// ============================================================================
// List Item PlainValueRef Factory
// ============================================================================

/**
 * Create a PlainValueRef for a list item at a given index.
 *
 * Unlike struct/record PlainValueRefs which use string paths, list item refs
 * use a numeric index and read/write directly from the list container.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The value shape for the list items
 * @returns A PlainValueRef that reads/writes through the list container
 */
export function createListItemPlainValueRef<T>(
  internals: BaseRefInternals<any>,
  index: number,
  shape: ValueShape,
): PlainValueRef<T> {
  const getValue = (): T => resolveListValue<T>(internals, index) as T
  const base = buildBasePlainValueRef(
    getValue,
    internals,
    [String(index)], // Store index as path for compatibility
    shape,
    index, // Pass list index
  )

  // For nested struct value shapes, wrap in Proxy to enable property access
  if (shape.valueType === "struct" && "shape" in shape) {
    return createListItemStructProxy(
      base,
      internals,
      index,
      shape as StructValueShape,
    )
  }

  // For record value shapes, wrap in Proxy to enable dynamic property access
  if (shape.valueType === "record" && "shape" in shape) {
    return createListItemRecordProxy(
      base,
      internals,
      index,
      shape as RecordValueShape,
    )
  }

  return base
}

/**
 * Create a Proxy wrapper for struct value shapes in list items.
 * Enables nested property access on list items with struct value shapes.
 *
 * @param base - The base PlainValueRef object
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The struct value shape
 * @returns A Proxy-wrapped PlainValueRef
 */
function createListItemStructProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  index: number,
  shape: StructValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      if (preamble.prop in shape.shape) {
        const nestedShape = shape.shape[preamble.prop]

        // Always return PlainValueRef for nested properties (consistent with createStructProxy).
        // This ensures .set() is available on all nested properties, including primitives.
        return createListItemNestedPlainValueRef(
          internals,
          index,
          [preamble.prop],
          nestedShape,
        )
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

/**
 * Create a Proxy wrapper for record value shapes in list items.
 * Enables dynamic property access on list items with record value shapes.
 *
 * @param base - The base PlainValueRef object
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The record value shape
 * @returns A Proxy-wrapped PlainValueRef
 */
function createListItemRecordProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  index: number,
  shape: RecordValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      const currentValue = target.valueOf() as Record<string, unknown>
      if (currentValue && typeof currentValue === "object") {
        const propValue = currentValue[preamble.prop]
        if (propValue === undefined) return undefined
        // Always return PlainValueRef for record values so .set() is available
        if (shape.shape) {
          return createListItemNestedPlainValueRef(
            internals,
            index,
            [preamble.prop],
            shape.shape,
          )
        }
        if (runtimePrimitiveCheck(propValue)) return propValue
        return propValue
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

/**
 * Create a nested PlainValueRef for a property within a list item.
 * This enables deep nested mutation tracking like `list[0].metadata.author = "Alice"`.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param nestedPath - Path from the list item root to this nested value
 * @param shape - The value shape for this nested value
 * @returns A PlainValueRef that reads/writes through the list item
 */
function createListItemNestedPlainValueRef<T>(
  internals: BaseRefInternals<any>,
  index: number,
  nestedPath: string[],
  shape: ValueShape,
): PlainValueRef<T> {
  const getValue = (): T => {
    const itemValue = resolveListValue<Record<string, unknown>>(
      internals,
      index,
    )
    if (itemValue === null || typeof itemValue !== "object") {
      return undefined as T
    }
    // Navigate to the nested value
    let current: unknown = itemValue
    for (const key of nestedPath) {
      if (current === null || typeof current !== "object") {
        return undefined as T
      }
      current = (current as Record<string, unknown>)[key]
    }
    return current as T
  }

  const base = buildBasePlainValueRef(
    getValue,
    internals,
    [String(index), ...nestedPath],
    shape,
    index, // Pass list index
    nestedPath, // Pass nested path for read-modify-write in .set()
  )

  // For nested struct value shapes, wrap in Proxy to enable deeper property access
  if (shape.valueType === "struct" && "shape" in shape) {
    return createListItemNestedStructProxy(
      base,
      internals,
      index,
      nestedPath,
      shape as StructValueShape,
    )
  }

  // For nested record value shapes, wrap in Proxy to enable dynamic property access
  if (shape.valueType === "record" && "shape" in shape) {
    return createListItemNestedRecordProxy(
      base,
      internals,
      index,
      nestedPath,
      shape as RecordValueShape,
    )
  }

  return base
}

/**
 * Create a Proxy for nested struct within a list item.
 */
function createListItemNestedStructProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  index: number,
  nestedPath: string[],
  shape: StructValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      if (preamble.prop in shape.shape) {
        // Always return PlainValueRef for nested properties (consistent with createStructProxy).
        return createListItemNestedPlainValueRef(
          internals,
          index,
          [...nestedPath, preamble.prop],
          shape.shape[preamble.prop],
        )
      }
      return undefined
    },
  }) as PlainValueRef<T>
}

/**
 * Create a Proxy for nested record within a list item.
 */
function createListItemNestedRecordProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  index: number,
  nestedPath: string[],
  shape: RecordValueShape,
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const preamble = proxyGetPreamble(target, prop, receiver)
      if (preamble.handled) return preamble.value

      const currentValue = target.valueOf() as Record<string, unknown>
      if (currentValue && typeof currentValue === "object") {
        const propValue = currentValue[preamble.prop]
        if (propValue === undefined) return undefined
        // Always return PlainValueRef for record values so .set() is available
        if (shape.shape) {
          return createListItemNestedPlainValueRef(
            internals,
            index,
            [...nestedPath, preamble.prop],
            shape.shape,
          )
        }
        if (runtimePrimitiveCheck(propValue)) return propValue
        return propValue
      }
      return undefined
    },
  }) as PlainValueRef<T>
}
