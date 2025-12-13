import type { LoroDoc } from "loro-crdt"
import type { DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { Mutable } from "./types.js"

/**
 * The primary method of mutating typed documents.
 * Batches multiple mutations into a single transaction.
 * All changes commit together at the end.
 *
 * Use this for:
 * - Find-and-mutate operations (required due to JS limitations)
 * - Performance (fewer commits)
 * - Atomic undo (all changes = one undo step)
 *
 * Returns the doc for chaining.
 *
 * @param doc - The TypedDoc to mutate
 * @param fn - Function that performs mutations on the draft
 * @returns The same TypedDoc for chaining
 *
 * @example
 * ```typescript
 * import { change } from "@loro-extended/change"
 *
 * // Chainable API
 * change(doc, draft => {
 *   draft.count.increment(10)
 *   draft.title.update("Hello")
 * })
 *   .count.increment(5)  // Optional: continue mutating
 *   .toJSON()            // Optional: get last item snapshot when needed
 * ```
 */
export function change<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  fn: (draft: Mutable<Shape>) => void,
): TypedDoc<Shape> {
  return doc.$.change(fn)
}

/**
 * Access the underlying LoroDoc for advanced operations.
 *
 * @param doc - The TypedDoc to unwrap
 * @returns The underlying LoroDoc instance
 *
 * @example
 * ```typescript
 * import { getLoroDoc } from "@loro-extended/change"
 *
 * const loroDoc = getLoroDoc(doc)
 * const version = loroDoc.version()
 * loroDoc.subscribe(() => console.log("changed"))
 * ```
 */
export function getLoroDoc<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
): LoroDoc {
  return doc.$.loroDoc
}
