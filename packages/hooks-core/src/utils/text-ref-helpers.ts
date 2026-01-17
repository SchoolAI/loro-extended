import type { TextRef } from "@loro-extended/change"
import { loro } from "@loro-extended/change"

/**
 * Well-known symbol for accessing internal methods on TypedRefs.
 * This is the same symbol used by @loro-extended/change.
 */
const INTERNAL_SYMBOL = Symbol.for("loro-extended:internal")

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
  return loro(textRef).container.getShallowValue()
}

/**
 * Get the placeholder value from a TypedRef, if one is defined.
 * Returns undefined if no placeholder is set or if the placeholder is an empty string.
 */
export function getPlaceholder<T>(ref: unknown): T | undefined {
  const placeholder = (ref as any)[INTERNAL_SYMBOL]?.getPlaceholder() as
    | T
    | undefined
  // Treat empty string as "no placeholder" for consistency
  if (placeholder === "") return undefined
  return placeholder
}
