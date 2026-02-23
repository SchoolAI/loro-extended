/**
 * Value reader functions for PlainValueRef.
 * These functions read values from the Loro container with overlay and placeholder fallback.
 *
 * @module plain-value-ref/value-reader
 */

import type { LoroList, LoroMap, LoroMovableList, MapDiff } from "loro-crdt"
import type { BaseRefInternals } from "../typed-refs/base.js"
import { getAtPath } from "../utils/path-ops.js"

/**
 * Get a value from the diff overlay (if present).
 * Used for "before" views in getTransition().
 *
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to the value
 * @returns The value from the overlay, or undefined if not in overlay
 */
export function getOverlayValue(
  internals: BaseRefInternals<any>,
  path: string[],
): unknown | undefined {
  const overlay = internals.getOverlay()
  if (!overlay) return undefined

  const container = internals.getContainer() as LoroMap
  const containerId = (container as any).id
  const diff = overlay.get(containerId)

  if (diff?.type !== "map") return undefined
  const mapDiff = diff as MapDiff

  // Check if the root key of the path was updated in the overlay
  if (!(path[0] in mapDiff.updated)) return undefined

  // Get the updated value and traverse the rest of the path
  return getAtPath(mapDiff.updated[path[0]], path.slice(1))
}

/**
 * Get a value from the Loro container.
 *
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to the value
 * @returns The value from the container, or undefined if not present
 */
export function getContainerValue(
  internals: BaseRefInternals<any>,
  path: string[],
): unknown | undefined {
  const container = internals.getContainer() as LoroMap
  const rootValue = container.get(path[0])
  if (rootValue === undefined) return undefined
  return getAtPath(rootValue, path.slice(1))
}

/**
 * Get a value from the placeholder (default value).
 *
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to the value
 * @returns The value from the placeholder, or undefined if not present
 */
export function getPlaceholderValue(
  internals: BaseRefInternals<any>,
  path: string[],
): unknown | undefined {
  const placeholder = internals.getPlaceholder() as
    | Record<string, unknown>
    | undefined
  if (!placeholder) return undefined
  return getAtPath(placeholder[path[0]], path.slice(1))
}

/**
 * Resolve a value using the fallback chain: overlay → container → placeholder.
 * This is the main entry point for reading values through PlainValueRef.
 *
 * @param internals - The parent ref's internals
 * @param path - Path from the parent container to the value
 * @returns The resolved value, or undefined if not found anywhere
 */
export function resolveValue<T>(
  internals: BaseRefInternals<any>,
  path: string[],
): T | undefined {
  // Use explicit undefined checks instead of ?? to correctly handle null values.
  // The ?? operator treats null as nullish, which would skip a deliberately-stored
  // null in the container and fall through to the placeholder.
  const overlay = getOverlayValue(internals, path)
  if (overlay !== undefined) return overlay as T
  const container = getContainerValue(internals, path)
  if (container !== undefined) return container as T
  return getPlaceholderValue(internals, path) as T | undefined
}

// ============================================================================
// List-specific value reading functions
// ============================================================================

/**
 * Get a value from the diff overlay for a list item.
 * Used for "before" views in getTransition().
 *
 * The internals parameter is expected to be a ListRefBaseInternals which has
 * a getOverlayList() method that caches the reconstructed "before" list.
 *
 * @param internals - The list ref's internals (must have getOverlayList method)
 * @param index - The list index
 * @returns The value from the overlay, or undefined if not in overlay
 */
export function getListOverlayValue(
  internals: BaseRefInternals<any>,
  index: number,
): unknown | undefined {
  const overlay = internals.getOverlay()
  if (!overlay) return undefined

  // Check if internals has getOverlayList method (ListRefBaseInternals)
  // This method caches the reconstructed "before" list using applyListDelta
  if (
    "getOverlayList" in internals &&
    typeof (internals as any).getOverlayList === "function"
  ) {
    const overlayList = (internals as any).getOverlayList() as
      | unknown[]
      | undefined
    if (overlayList) {
      return overlayList[index]
    }
  }

  // Fallback: no overlay list available
  return undefined
}

/**
 * Get a value from a Loro list container.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @returns The value from the container, or undefined if not present
 */
export function getListContainerValue(
  internals: BaseRefInternals<any>,
  index: number,
): unknown | undefined {
  const container = internals.getContainer() as LoroList | LoroMovableList
  return container.get(index)
}

/**
 * Resolve a list item value using the fallback chain: overlay → container.
 * Note: List items don't have placeholders in the same way as struct properties.
 *
 * @param internals - The list ref's internals
 * @param index - The list index
 * @returns The resolved value, or undefined if not found
 */
export function resolveListValue<T>(
  internals: BaseRefInternals<any>,
  index: number,
): T | undefined {
  // Use explicit undefined checks instead of ?? to correctly handle null values.
  // The ?? operator treats null as nullish, which would skip a deliberately-stored
  // null in the overlay and fall through to the container value.
  const overlay = getListOverlayValue(internals, index)
  if (overlay !== undefined) return overlay as T
  return getListContainerValue(internals, index) as T | undefined
}
