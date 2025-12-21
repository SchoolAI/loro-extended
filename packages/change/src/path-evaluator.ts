// ============================================================================
// Path Evaluator
// ============================================================================
//
// Evaluates a path selector against a TypedDoc to get the current value.
// This is used for:
// 1. Establishing the initial previousValue baseline
// 2. Getting the current value when subscribeJsonpath fires
// 3. Deep equality comparison to filter false positives

import type { PathSegment, PathSelector } from "./path-selector.js"
import type { DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"

/**
 * Evaluate a path selector against a TypedDoc to get the current value.
 * Returns the value(s) at the path, properly typed.
 *
 * @example
 * ```typescript
 * const selector = builder.books.$each.title
 * const titles = evaluatePath(doc, selector)
 * // titles: string[]
 * ```
 */
export function evaluatePath<D extends DocShape, T>(
  doc: TypedDoc<D>,
  selector: PathSelector<T>,
): T {
  const json = doc.$.toJSON()
  return evaluatePathOnValue(json, selector.__segments) as T
}

/**
 * Evaluate path segments against a plain JavaScript value.
 * This is the core recursive evaluation logic.
 */
export function evaluatePathOnValue(
  value: unknown,
  segments: PathSegment[],
): unknown {
  if (segments.length === 0) {
    return value
  }

  const [segment, ...rest] = segments

  switch (segment.type) {
    case "property":
    case "key":
      if (value == null) return undefined
      if (typeof value !== "object") return undefined
      return evaluatePathOnValue(
        (value as Record<string, unknown>)[segment.key],
        rest,
      )

    case "index": {
      if (!Array.isArray(value)) return undefined
      // Handle negative indices: -1 = last, -2 = second-to-last, etc.
      const index =
        segment.index < 0 ? value.length + segment.index : segment.index
      if (index < 0 || index >= value.length) return undefined
      return evaluatePathOnValue(value[index], rest)
    }

    case "each":
      if (Array.isArray(value)) {
        return value.map(item => evaluatePathOnValue(item, rest))
      }
      if (typeof value === "object" && value !== null) {
        return Object.values(value).map(item => evaluatePathOnValue(item, rest))
      }
      return []
  }
}
