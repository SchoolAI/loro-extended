/**
 * Value writer functions for PlainValueRef.
 * These functions write values to the Loro container through the parent ref.
 *
 * @module plain-value-ref/value-writer
 */

import type { LoroList, LoroMap, LoroMovableList } from "loro-crdt"
import type { BaseRefInternals } from "../typed-refs/base.js"
import { setAtPath } from "../utils/path-ops.js"

/**
 * Write a value to the Loro container through the parent ref's internals.
 * This performs an eager read-modify-write for nested paths.
 *
 * For single-segment paths (e.g., ["title"]), it sets the value directly.
 * For multi-segment paths (e.g., ["nested", "value"]), it:
 * 1. Reads the current root value
 * 2. Creates a new object with the nested value updated
 * 3. Writes the entire root value back
 *
 * This eager write-back pattern ensures nested mutations are immediately
 * persisted to Loro without requiring deferred batch processing.
 *
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to the value
 * @param value - The value to write
 */
export function writeValue(
  internals: BaseRefInternals<any>,
  path: string[],
  value: unknown,
): void {
  const container = internals.getContainer() as LoroMap

  if (path.length === 1) {
    // Simple case: direct property on the parent container
    container.set(path[0], value)
  } else {
    // Nested case: read-modify-write the root property
    const rootKey = path[0]
    const current = container.get(rootKey) ?? {}
    const updated = setAtPath(current, path.slice(1), value)
    container.set(rootKey, updated)
  }

  internals.commitIfAuto()
}

// ============================================================================
// List-specific value writing functions
// ============================================================================

/**
 * Write a value to a Loro list container at a specific index.
 * This performs an immediate write operation on the list.
 *
 * For LoroMovableList, uses the `.set()` method directly.
 * For LoroList, uses delete+insert since LoroList doesn't have `.set()`.
 *
 * @param internals - The list ref's internals
 * @param index - The list index to write to
 * @param value - The value to write
 */
export function writeListValue(
  internals: BaseRefInternals<any>,
  index: number,
  value: unknown,
): void {
  const container = internals.getContainer() as LoroList | LoroMovableList

  // Check if container has .set() method (LoroMovableList has it, LoroList doesn't)
  if (
    "set" in container &&
    typeof (container as LoroMovableList).set === "function"
  ) {
    // LoroMovableList: use .set() directly
    ;(container as LoroMovableList).set(index, value)
  } else {
    // LoroList: use delete+insert since it doesn't have .set()
    ;(container as LoroList).delete(index, 1)
    ;(container as LoroList).insert(index, value)
  }

  internals.commitIfAuto()
}

/**
 * Write a value to a nested path within a list item, using read-modify-write.
 *
 * This is needed when mutating a property inside a list item (e.g., `item.active.set(true)`
 * where `item` is at list index 0 and `active` is a nested path within the item).
 *
 * The operation:
 * 1. Reads the current item at the given index
 * 2. Updates the value at the nested path within the item
 * 3. Writes the entire modified item back to the list
 *
 * @param internals - The list ref's internals
 * @param index - The list index of the item
 * @param nestedPath - Path within the item to the value (e.g., ["active"] or ["metadata", "published"])
 * @param value - The value to write at the nested path
 */
export function writeListValueAtPath(
  internals: BaseRefInternals<any>,
  index: number,
  nestedPath: string[],
  value: unknown,
): void {
  const container = internals.getContainer() as LoroList | LoroMovableList
  const current = container.get(index) ?? {}
  const updated = setAtPath(current, nestedPath, value)
  writeListValue(internals, index, updated)
}
