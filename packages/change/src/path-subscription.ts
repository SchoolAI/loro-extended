// ============================================================================
// Path Subscription
// ============================================================================
//
// Provides path-based subscriptions for TypedDocs. This module handles the
// complexity of subscribing to specific paths within a document, using
// either efficient JSONPath subscriptions or global subscriptions with
// filtering depending on the storage mode.

import type { LoroDoc, Subscription } from "loro-crdt"
import { EXT_SYMBOL, ext } from "./ext.js"
import { loro } from "./loro.js"
import { createPathBuilder } from "./path-builder.js"
import { compileToJsonPath } from "./path-compiler.js"
import { evaluatePath } from "./path-evaluator.js"
import type { PathBuilder, PathSegment, PathSelector } from "./path-selector.js"
import type { ContainerOrValueShape, DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"

/**
 * Determines if a path subscription requires global subscription with manual filtering.
 *
 * In mergeable (flattened) storage mode, struct and record containers are stored
 * at the root level, not hierarchically. This means JSONPath subscriptions can't
 * efficiently filter to just those paths. We must use global subscriptions and
 * manually evaluate the path on each change.
 *
 * @param segments - The path segments to analyze
 * @param docShape - The document shape to walk against
 * @param mergeable - Whether the document uses mergeable storage
 * @returns true if global subscription is required, false if subscribeJsonpath can be used
 */
export function requiresGlobalSubscription(
  segments: PathSegment[],
  docShape: DocShape,
  mergeable: boolean,
): boolean {
  // Non-mergeable docs use hierarchical storage, so JSONPath always works
  if (!mergeable) {
    return false
  }

  // Walk the path segments against the schema to detect flattening boundaries
  let currentShape: ContainerOrValueShape | undefined

  for (const segment of segments) {
    if (segment.type === "property") {
      // First segment accesses a top-level shape
      if (currentShape === undefined) {
        currentShape = docShape.shapes[segment.key]
      } else if (currentShape._type === "struct") {
        // Entering a struct child in mergeable mode = flattening boundary
        return true
      } else if (currentShape._type === "record") {
        // Entering a record child in mergeable mode = flattening boundary
        return true
      } else {
        // Shouldn't happen for valid paths, but be safe
        return true
      }
    } else if (segment.type === "each" || segment.type === "index") {
      // Wildcards and indices on lists are fine - lists keep hierarchical structure
      if (
        currentShape?._type === "list" ||
        currentShape?._type === "movableList"
      ) {
        currentShape = currentShape.shape
      } else if (currentShape?._type === "record") {
        // Entering a record's values in mergeable mode = flattening boundary
        return true
      } else {
        // Invalid path structure
        return true
      }
    } else if (segment.type === "key") {
      // Specific key on a record in mergeable mode = flattening boundary
      if (currentShape?._type === "record") {
        return true
      }
      // Invalid path structure
      return true
    }
  }

  return false
}

/**
 * Subscribe to changes at a specific path within a TypedDoc.
 *
 * This function provides type-safe path-based subscriptions. The callback
 * receives the current value at the path whenever it changes.
 *
 * @param doc - The TypedDoc to subscribe to
 * @param selector - A function that selects the path using the path builder DSL
 * @param callback - Called with the new value when the path changes
 * @returns An unsubscribe function
 *
 * @example
 * ```typescript
 * // Subscribe to a specific config value
 * subscribeToPath(doc, p => p.config.theme, (theme) => {
 *   console.log("Theme changed:", theme)
 * })
 *
 * // Subscribe to all book titles (returns array)
 * subscribeToPath(doc, p => p.books.$each.title, (titles) => {
 *   console.log("Titles:", titles)
 * })
 * ```
 */
export function subscribeToPath<D extends DocShape, R>(
  doc: TypedDoc<D>,
  selector: (p: PathBuilder<D>) => PathSelector<R>,
  callback: (value: R) => void,
): () => void {
  const extNs = (doc as any)[EXT_SYMBOL]
  if (!extNs || !("docShape" in extNs)) {
    throw new Error("subscribeToPath requires a TypedDoc")
  }

  const docShape = ext(doc).docShape as D
  const mergeable = ext(doc).mergeable
  const loroDoc = loro(doc) as LoroDoc

  // Create path builder and apply selector to get segments
  const pathBuilder = createPathBuilder(docShape)
  const pathSelector = selector(pathBuilder)
  const segments = pathSelector.__segments

  // Track previous value for deep equality comparison
  let previousValue: string | undefined

  // Helper to get current value and check if changed
  const getValueIfChanged = (): { value: R; changed: boolean } => {
    const value = evaluatePath(doc, pathSelector)
    const serialized = JSON.stringify(value)
    const changed = serialized !== previousValue
    if (changed) {
      previousValue = serialized
    }
    return { value, changed }
  }

  // Initialize previous value
  previousValue = JSON.stringify(evaluatePath(doc, pathSelector))

  // Determine subscription strategy
  const needsGlobalSubscription = requiresGlobalSubscription(
    segments,
    docShape,
    mergeable,
  )

  let subscription: Subscription

  if (needsGlobalSubscription) {
    // Use global subscription with manual filtering
    subscription = loroDoc.subscribe(() => {
      const { value, changed } = getValueIfChanged()
      if (changed) {
        callback(value)
      }
    })
  } else {
    // Use efficient JSONPath subscription
    const jsonPath = compileToJsonPath(segments)
    subscription = loroDoc.subscribeJsonpath(jsonPath, () => {
      const { value, changed } = getValueIfChanged()
      if (changed) {
        callback(value)
      }
    })
  }

  // Return unsubscribe function
  return () => {
    subscription()
  }
}
