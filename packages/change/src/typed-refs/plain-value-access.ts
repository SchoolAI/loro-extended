/**
 * Shared helper functions for PlainValueRef access in typed refs.
 * These utilities are used by StructRefInternals, RecordRefInternals, and ListRefBaseInternals.
 *
 * @module typed-refs/plain-value-access
 */

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
 * Resolve a value for batched mutation.
 *
 * Always returns PlainValueRef for consistent method-based read/write
 * both inside and outside `change()` blocks:
 * - Read: `draft.meta.title.get()`
 * - Write: `draft.meta.title.set("new value")`
 *
 * @param internals - The parent ref's internals (provides access to container, placeholder)
 * @param key - The property key to read
 * @param shape - The value shape for this property
 * @returns PlainValueRef for method-based access
 */
export function resolveValueForBatchedMutation<T>(
  internals: BaseRefInternals<any>,
  key: string,
  shape: ValueShape,
): PlainValueRef<T> {
  return createPlainValueRefForProperty<T>(internals, key, shape)
}

/**
 * Resolve a list item value for batched mutation.
 *
 * Always returns PlainValueRef for consistent method-based read/write.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @param shape - The value shape for list items
 * @param _rawValue - Unused (kept for call-site compatibility)
 * @returns PlainValueRef for method-based access
 */
export function resolveListValueForBatchedMutation<T>(
  internals: BaseRefInternals<any>,
  index: number,
  shape: ValueShape,
  _rawValue: unknown,
): PlainValueRef<T> {
  return createPlainValueRefForListItem<T>(internals, index, shape)
}
