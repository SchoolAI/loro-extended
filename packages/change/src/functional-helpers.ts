import type {
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import { loro } from "./loro.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  CounterContainerShape,
  DocShape,
  ListContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  ShapeToContainer,
  StructContainerShape,
  TextContainerShape,
} from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { StructRef } from "./typed-refs/struct.js"
import type { TreeRef } from "./typed-refs/tree.js"
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
  return doc.change(fn)
}

/**
 * Access the underlying LoroDoc for advanced operations.
 * Works on both TypedDoc and any typed ref (TextRef, CounterRef, ListRef, etc.).
 *
 * @param docOrRef - The TypedDoc or typed ref to unwrap
 * @returns The underlying LoroDoc instance (or undefined for refs created outside a doc context)
 *
 * @example
 * ```typescript
 * import { getLoroDoc } from "@loro-extended/change"
 *
 * // From TypedDoc
 * const loroDoc = getLoroDoc(doc)
 * const version = loroDoc.version()
 * loroDoc.subscribe(() => console.log("changed"))
 *
 * // From any ref (TextRef, CounterRef, ListRef, etc.)
 * const titleRef = doc.title
 * const loroDoc = getLoroDoc(titleRef)
 * loroDoc?.subscribe(() => console.log("changed"))
 * ```
 */
export function getLoroDoc<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
): LoroDoc
export function getLoroDoc<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): LoroDoc
export function getLoroDoc<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
): LoroDoc
export function getLoroDoc(
  docOrRef: TypedDoc<any> | TypedRef<any> | TreeRef<any>,
): LoroDoc {
  // Use loro() to access the underlying LoroDoc
  return loro(docOrRef as any).doc
}

/**
 * Access the underlying Loro container from a typed ref.
 * Returns the correctly-typed container based on the ref type.
 *
 * @param ref - The typed ref to unwrap
 * @returns The underlying Loro container (LoroText, LoroCounter, LoroList, etc.)
 *
 * @example
 * ```typescript
 * import { getLoroContainer } from "@loro-extended/change"
 *
 * const titleRef = doc.title
 * const loroText = getLoroContainer(titleRef)  // LoroText
 *
 * const countRef = doc.count
 * const loroCounter = getLoroContainer(countRef)  // LoroCounter
 *
 * const itemsRef = doc.items
 * const loroList = getLoroContainer(itemsRef)  // LoroList
 *
 * // Subscribe to container-level changes
 * loroText.subscribe((event) => console.log("Text changed:", event))
 * ```
 */
export function getLoroContainer(ref: TypedRef<TextContainerShape>): LoroText
export function getLoroContainer(
  ref: TypedRef<CounterContainerShape>,
): LoroCounter
export function getLoroContainer(ref: TypedRef<ListContainerShape>): LoroList
export function getLoroContainer(
  ref: TypedRef<MovableListContainerShape>,
): LoroMovableList
export function getLoroContainer(ref: TypedRef<RecordContainerShape>): LoroMap
export function getLoroContainer(ref: TypedRef<StructContainerShape>): LoroMap
export function getLoroContainer<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(ref: StructRef<NestedShapes>): LoroMap
export function getLoroContainer<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
): LoroTree
export function getLoroContainer<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): ShapeToContainer<Shape>
export function getLoroContainer(
  ref: TypedRef<any> | TreeRef<any> | StructRef<any>,
): unknown {
  // Use loro() to access the underlying container
  return loro(ref as any).container
}
