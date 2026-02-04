/**
 * The `loro()` function - access native Loro types directly.
 *
 * Design Principle:
 * > `loro()` returns native Loro types directly (LoroDoc, LoroText, etc.)
 * > `ext()` provides loro-extended-specific features (change, fork, subscribe with jsonpath, etc.)
 *
 * @example
 * ```typescript
 * import { loro, ext } from "@loro-extended/change"
 *
 * // Access native Loro types directly
 * const loroDoc = loro(doc)  // LoroDoc
 * loroDoc.frontiers()
 * loroDoc.subscribe(callback)
 *
 * const loroText = loro(doc.title)  // LoroText
 * loroText.length
 *
 * // Access loro-extended features via ext()
 * ext(doc).change(draft => { ... })
 * ext(doc).forkAt(frontiers)
 * ext(ref).doc  // Get LoroDoc from any ref
 * ```
 */

import type {
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  LoroTreeNode,
} from "loro-crdt"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  StructContainerShape,
  TreeRefInterface,
} from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { CounterRef } from "./typed-refs/counter-ref.js"
import type { ListRef } from "./typed-refs/list-ref.js"
import type { MovableListRef } from "./typed-refs/movable-list-ref.js"
import type { RecordRef } from "./typed-refs/record-ref.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TextRef } from "./typed-refs/text-ref.js"
import type { TreeNodeRef } from "./typed-refs/tree-node-ref.js"
import type { TreeRef } from "./typed-refs/tree-ref.js"

// ============================================================================
// Symbol for loro() access
// ============================================================================

/**
 * Well-known Symbol for loro() access.
 * This is exported so advanced users can access it directly if needed.
 */
export const LORO_SYMBOL = Symbol.for("loro-extended:loro")

// ============================================================================
// loro() function overloads
// ============================================================================

/**
 * Access the native LoroList for a ListRef.
 */
export function loro<NestedShape extends ContainerOrValueShape>(
  ref: ListRef<NestedShape>,
): LoroList

/**
 * Access the native LoroMovableList for a MovableListRef.
 */
export function loro<NestedShape extends ContainerOrValueShape>(
  ref: MovableListRef<NestedShape>,
): LoroMovableList

/**
 * Access the native LoroMap for a StructRef.
 */
export function loro<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(ref: StructRef<NestedShapes>): LoroMap

/**
 * Access the native LoroMap for a RecordRef.
 */
export function loro<NestedShape extends ContainerOrValueShape>(
  ref: RecordRef<NestedShape>,
): LoroMap

/**
 * Access the native LoroText for a TextRef.
 */
export function loro(ref: TextRef): LoroText

/**
 * Access the native LoroCounter for a CounterRef.
 */
export function loro(ref: CounterRef): LoroCounter

/**
 * Access the native LoroTree for a TreeRef.
 */
export function loro<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape> | TreeRefInterface<DataShape>,
): LoroTree

/**
 * Access the native LoroTreeNode for a TreeNodeRef.
 */
export function loro<DataShape extends StructContainerShape>(
  ref: TreeNodeRef<DataShape>,
): LoroTreeNode

/**
 * Access the native LoroDoc for a TypedDoc.
 */
export function loro<Shape extends DocShape>(doc: TypedDoc<Shape>): LoroDoc

/**
 * Access the native Loro container for any TypedRef.
 */
export function loro<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): unknown

/**
 * The `loro()` function - access native Loro types directly.
 *
 * Use this to access:
 * - The underlying LoroDoc from a TypedDoc
 * - The underlying Loro container (LoroText, LoroList, etc.) from a TypedRef
 *
 * @param refOrDoc - A TypedRef or TypedDoc
 * @returns The native Loro type (LoroDoc, LoroText, LoroList, etc.)
 *
 * @example
 * ```typescript
 * import { loro } from "@loro-extended/change"
 *
 * // Access native LoroDoc
 * const loroDoc = loro(doc)
 * loroDoc.frontiers()
 * loroDoc.subscribe(callback)
 *
 * // Access native Loro containers
 * const loroText = loro(doc.title)  // LoroText
 * const loroList = loro(doc.items)  // LoroList
 * const loroMap = loro(doc.settings)  // LoroMap
 * ```
 */
export function loro(
  refOrDoc:
    | TypedRef<any>
    | TypedDoc<any>
    | TreeRef<any>
    | TreeRefInterface<any>
    | TreeNodeRef<any>
    | StructRef<any>,
): unknown {
  // Access the loro value via the well-known symbol
  const loroValue = (refOrDoc as any)[LORO_SYMBOL]
  if (loroValue === undefined) {
    throw new Error(
      "Invalid argument: expected TypedRef, TreeRef, or TypedDoc with loro() support",
    )
  }
  return loroValue
}
