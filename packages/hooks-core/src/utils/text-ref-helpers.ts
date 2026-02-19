import type { PlainValueRef, TextRef } from "@loro-extended/change"
import {
  getPlainValueRefParentInternals,
  getPlainValueRefPath,
  loro,
} from "@loro-extended/change"
import type { Container } from "loro-crdt"
import { getPlaceholderSafe } from "./type-guards"

/**
 * Check if a ref is a TextRef.
 */
export function isTextRef(ref: unknown): ref is TextRef {
  return (
    ref !== null &&
    typeof ref === "object" &&
    "insert" in ref &&
    "delete" in ref &&
    "update" in ref &&
    "mark" in ref
  )
}

/**
 * Get the raw CRDT value from a TextRef, bypassing placeholder logic.
 * This returns the actual content stored in the CRDT, which may be empty
 * even if textRef.toString() would return a placeholder.
 */
export function getRawTextValue(textRef: TextRef): string {
  return loro(textRef).getShallowValue()
}

/**
 * Get the placeholder value from a TypedRef, if one is defined.
 * Returns undefined if no placeholder is set or if the placeholder is an empty string.
 *
 * Uses type-safe access via the INTERNAL_SYMBOL.
 */
export function getPlaceholder<T>(ref: unknown): T | undefined {
  return getPlaceholderSafe<T>(ref)
}

/**
 * Extract value and parent container from a PlainValueRef.
 * Used by useValue to subscribe to the parent container for changes.
 */
export function getPlainValueRefValue<T>(ref: PlainValueRef<T>): {
  value: T
  container: Container
} {
  const internals = getPlainValueRefParentInternals(ref)
  const path = getPlainValueRefPath(ref)

  // Get the parent container
  const container = internals.getContainer() as Container

  // Get the current value by traversing the path
  let current: unknown = container.getShallowValue()
  for (const segment of path) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment]
    } else {
      current = undefined
      break
    }
  }

  return { value: current as T, container }
}
