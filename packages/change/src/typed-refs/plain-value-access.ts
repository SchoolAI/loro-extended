/**
 * Shared helper functions for PlainValueRef access in typed refs.
 * These utilities are used by StructRefInternals, RecordRefInternals, and ListRefBaseInternals.
 *
 * @module typed-refs/plain-value-access
 */

import type { LoroMap } from "loro-crdt"
import { createListItemPlainValueRef } from "../plain-value-ref/factory.js"
import {
  createPlainValueRef,
  isPlainValueRef,
  type PlainValueRef,
} from "../plain-value-ref/index.js"
import type { ValueShape } from "../shape.js"
import type { BaseRefInternals } from "./base.js"

/**
 * Create a PlainValueRef for a property on a parent container.
 *
 * @param internals - The parent ref's internals
 * @param key - The property key
 * @param shape - The value shape for the property
 * @returns A PlainValueRef that reads/writes through the parent container
 */
export function createPlainValueRefForProperty<T>(
  internals: BaseRefInternals<any>,
  key: string,
  shape: ValueShape,
): PlainValueRef<T> {
  return createPlainValueRef<T>(internals, [key], shape)
}

/**
 * Create a PlainValueRef for an item in a list container.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The value shape for the item
 * @returns A PlainValueRef that reads/writes through the list container
 */
export function createPlainValueRefForListItem<T>(
  internals: BaseRefInternals<any>,
  index: number,
  shape: ValueShape,
): PlainValueRef<T> {
  return createListItemPlainValueRef<T>(internals, index, shape)
}

/**
 * Unwrap a value that may be a PlainValueRef.
 * If the value is a PlainValueRef, returns its current value via valueOf().
 * Otherwise, returns the value as-is.
 *
 * This is used in assignment handlers to support both:
 * - Direct assignment: `doc.meta.title = "new value"`
 * - PlainValueRef assignment: `doc.meta.title = otherDoc.meta.title`
 *
 * @param value - The value to potentially unwrap
 * @returns The unwrapped value
 */
export function unwrapPlainValueRef<T>(value: T | PlainValueRef<T>): T {
  if (isPlainValueRef(value)) {
    return value.valueOf() as T
  }
  return value
}

/**
 * Resolve a value for batched mutation, applying a runtime check for primitives.
 *
 * Inside `change()` blocks, we want:
 * - **Primitive values** (string, number, boolean, null) returned as raw values
 *   for ergonomic boolean logic (`if (draft.active)`, `!draft.published`)
 * - **Object/array values** wrapped in PlainValueRef for nested mutation tracking
 *   (`item.metadata.author = "Alice"`)
 *
 * This function replaces the old schema-based `valueType` heuristic which was
 * semantically wrong for `union` and `any` shapes that can contain either
 * primitives or objects at runtime.
 *
 * @param internals - The parent ref's internals (provides access to container, placeholder)
 * @param key - The property key to read
 * @param shape - The value shape for this property
 * @returns Raw value for primitives, PlainValueRef for objects/arrays
 */
export function resolveValueForBatchedMutation<T>(
  internals: BaseRefInternals<any>,
  key: string,
  shape: ValueShape,
): T | PlainValueRef<T> {
  const container = internals.getContainer() as LoroMap
  const rawValue = container.get(key)
  const resolved =
    rawValue !== undefined
      ? rawValue
      : (internals.getPlaceholder() as any)?.[key]

  // Return raw value only for actual primitives (not objects/arrays).
  // This handles union and any correctly regardless of what they contain at runtime.
  if (resolved === null || typeof resolved !== "object") {
    return resolved as T
  }

  // For objects/arrays, return PlainValueRef for nested mutation tracking
  return createPlainValueRefForProperty<T>(internals, key, shape)
}

/**
 * Resolve a list item value for batched mutation, applying a runtime check for primitives.
 *
 * Same logic as `resolveValueForBatchedMutation` but for list items by index.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The value shape for list items
 * @param rawValue - The raw value already read from the list
 * @returns Raw value for primitives, PlainValueRef for objects/arrays
 */
export function resolveListValueForBatchedMutation<T>(
  internals: BaseRefInternals<any>,
  index: number,
  shape: ValueShape,
  rawValue: unknown,
): T | PlainValueRef<T> {
  // Return raw value only for actual primitives (not objects/arrays).
  if (rawValue === null || typeof rawValue !== "object") {
    return rawValue as T
  }

  // For objects/arrays, return PlainValueRef for nested mutation tracking
  return createPlainValueRefForListItem<T>(internals, index, shape)
}
