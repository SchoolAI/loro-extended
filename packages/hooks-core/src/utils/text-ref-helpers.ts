import type { TextRef } from "@loro-extended/change"
import { loro } from "@loro-extended/change"
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
