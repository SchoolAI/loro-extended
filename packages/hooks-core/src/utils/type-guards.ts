/**
 * Type guards for runtime type checking.
 * These replace unsafe `any` casts with proper type narrowing.
 */

/**
 * Check if a value has a toJSON method.
 */
export function hasToJSON(value: unknown): value is { toJSON: () => unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON: unknown }).toJSON === "function"
  )
}

/**
 * Check if a value has a subscribe method (LoroRefBase-like).
 */
export function hasSubscribe(
  value: unknown,
): value is { subscribe: (callback: (event: unknown) => void) => () => void } {
  return (
    value !== null &&
    typeof value === "object" &&
    "subscribe" in value &&
    typeof (value as { subscribe: unknown }).subscribe === "function"
  )
}

/**
 * Well-known symbol for accessing internal methods on TypedRefs.
 * This is the same symbol used by @loro-extended/change.
 */
export const INTERNAL_SYMBOL = Symbol.for("loro-extended:internal")

/**
 * Check if a value has internal methods (TypedRef-like).
 */
export function hasInternalMethods(
  value: unknown,
): value is { [INTERNAL_SYMBOL]: { getPlaceholder?: () => unknown } } {
  return (
    value !== null &&
    typeof value === "object" &&
    INTERNAL_SYMBOL in value &&
    typeof (value as Record<symbol, unknown>)[INTERNAL_SYMBOL] === "object"
  )
}

/**
 * Safely get a placeholder from a value that may have internal methods.
 * Returns undefined if the value doesn't have a placeholder or internal methods.
 */
export function getPlaceholderSafe<T>(value: unknown): T | undefined {
  if (!hasInternalMethods(value)) {
    return undefined
  }

  const internal = value[INTERNAL_SYMBOL]
  if (
    internal &&
    typeof internal === "object" &&
    "getPlaceholder" in internal &&
    typeof internal.getPlaceholder === "function"
  ) {
    const placeholder = internal.getPlaceholder() as T | undefined
    // Treat empty string as "no placeholder" for consistency
    if (placeholder === "") return undefined
    return placeholder
  }

  return undefined
}

/**
 * Safely call toJSON on a value.
 * Returns undefined if the value doesn't have a toJSON method.
 */
export function toJSONSafe(value: unknown): unknown {
  if (!hasToJSON(value)) {
    return undefined
  }
  return value.toJSON()
}
