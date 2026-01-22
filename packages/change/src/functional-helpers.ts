import {
  type LoroCounter,
  LoroDoc,
  type LoroList,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
  type LoroTree,
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
  TreeRefInterface,
} from "./shape.js"
import { createTypedDoc, type Frontiers, type TypedDoc } from "./typed-doc.js"
import { INTERNAL_SYMBOL, type TypedRef } from "./typed-refs/base.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TreeRef } from "./typed-refs/tree-ref.js"
import { createContainerTypedRef } from "./typed-refs/utils.js"
import type { Mutable } from "./types.js"

/**
 * The primary method of mutating typed documents and refs.
 * Batches multiple mutations into a single transaction.
 * All changes commit together at the end.
 *
 * Use this for:
 * - Find-and-mutate operations (required due to JS limitations)
 * - Performance (fewer commits)
 * - Atomic undo (all changes = one undo step)
 *
 * Returns the doc/ref for chaining.
 *
 * @param target - The TypedDoc or TypedRef to mutate
 * @param fn - Function that performs mutations on the draft
 * @returns The same target for chaining
 *
 * @example
 * ```typescript
 * import { change } from "@loro-extended/change"
 *
 * // Document-level change (chainable)
 * change(doc, draft => {
 *   draft.count.increment(10)
 *   draft.title.update("Hello")
 * })
 *   .count.increment(5)  // Optional: continue mutating
 *   .toJSON()            // Optional: get snapshot
 *
 * // Ref-level change - enables encapsulation
 * function addItems(list: ListRef<...>) {
 *   change(list, draft => {
 *     draft.push({ name: "item1" })
 *     draft.push({ name: "item2" })
 *   })
 * }
 *
 * // TreeRef example - pass around refs without exposing the doc
 * function addStates(states: TreeRef<StateShape>) {
 *   change(states, draft => {
 *     draft.createNode({ name: "idle" })
 *     draft.createNode({ name: "running" })
 *   })
 * }
 * ```
 */
// Overload for TypedDoc
export function change<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  fn: (draft: Mutable<Shape>) => void,
): TypedDoc<Shape>

// Overload for TreeRef (special case - not a TypedRef<ContainerShape>)
export function change<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
  fn: (draft: TreeRef<DataShape>) => void,
): TreeRef<DataShape>

// Overload for TreeRefInterface (the mutable type from TreeContainerShape)
export function change<DataShape extends StructContainerShape>(
  ref: TreeRefInterface<DataShape>,
  fn: (draft: TreeRefInterface<DataShape>) => void,
): TreeRefInterface<DataShape>

// Overload for StructRef (special case - uses Proxy, not a class extending TypedRef)
// This must come before the generic TypedRef overload to match StructRef properly
export function change<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(
  ref: StructRef<NestedShapes>,
  fn: (draft: StructRef<NestedShapes>) => void,
): StructRef<NestedShapes>

// Overload for TypedRef (all container refs) - preserves concrete ref type
export function change<T extends TypedRef<ContainerShape>>(
  ref: T,
  fn: (draft: T) => void,
): T

// Implementation
export function change(
  target:
    | TypedDoc<any>
    | TypedRef<any>
    | TreeRef<any>
    | TreeRefInterface<any>
    | StructRef<any>,
  fn: (draft: any) => void,
):
  | TypedDoc<any>
  | TypedRef<any>
  | TreeRef<any>
  | TreeRefInterface<any>
  | StructRef<any> {
  // Check if it's a TypedDoc (has .change method)
  if ("change" in target && typeof (target as any).change === "function") {
    return (target as TypedDoc<any>).change(fn)
  }

  // It's a TypedRef or TreeRef - use ref-level change logic
  return changeRef(target as TypedRef<any> | TreeRef<any>, fn)
}

/**
 * Internal implementation for ref-level change.
 * Creates a draft ref with batchedMutation=true, executes the function,
 * absorbs changes, and commits.
 */
function changeRef<T extends TypedRef<any> | TreeRef<any>>(
  ref: T,
  fn: (draft: T) => void,
): T {
  // Get internals via INTERNAL_SYMBOL
  const internals = (ref as any)[INTERNAL_SYMBOL]
  if (!internals) {
    throw new Error(
      "change() requires a TypedRef with internal methods. " +
        "Make sure you're passing a valid typed ref.",
    )
  }

  // Get the params needed to create a draft
  const params = internals.getTypedRefParams()

  // Create draft params with batchedMutation enabled and autoCommit disabled
  const draftParams = {
    ...params,
    autoCommit: false,
    batchedMutation: true,
  }

  // Create the draft ref using the same factory that created the original
  const draft = createContainerTypedRef(draftParams) as T

  // Execute the user's function with the draft
  fn(draft)

  // Absorb any cached plain values back into the Loro containers
  const draftInternals = (draft as any)[INTERNAL_SYMBOL]
  draftInternals.absorbPlainValues()

  // Commit the changes
  // Note: Loro's commit() is idempotent, so nested calls are safe
  internals.getDoc().commit()

  // Return the original ref for chaining
  return ref
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
export function getLoroDoc<DataShape extends StructContainerShape>(
  ref: TreeRefInterface<DataShape>,
): LoroDoc
export function getLoroDoc(
  docOrRef:
    | TypedDoc<any>
    | TypedRef<any>
    | TreeRef<any>
    | TreeRefInterface<any>,
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
export function getLoroContainer<DataShape extends StructContainerShape>(
  ref: TreeRefInterface<DataShape>,
): LoroTree
export function getLoroContainer<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): ShapeToContainer<Shape>
export function getLoroContainer(
  ref: TypedRef<any> | TreeRef<any> | TreeRefInterface<any> | StructRef<any>,
): unknown {
  // Use loro() to access the underlying container
  return loro(ref as any).container
}

/**
 * Creates a new TypedDoc at a specified version (frontiers).
 * The forked doc will only contain history before the specified frontiers.
 * The forked doc has a different PeerID from the original.
 *
 * For raw LoroDoc access, use: `loro(doc).doc.forkAt(frontiers)`
 *
 * @param doc - The TypedDoc to fork
 * @param frontiers - The version to fork at (obtained from `loro(doc).doc.frontiers()`)
 * @returns A new TypedDoc with the same schema at the specified version
 *
 * @example
 * ```typescript
 * import { forkAt, loro } from "@loro-extended/change"
 *
 * const doc = createTypedDoc(schema);
 * doc.title.update("Hello");
 * const frontiers = loro(doc).doc.frontiers();
 * doc.title.update("World");
 *
 * // Fork at the earlier version
 * const forkedDoc = forkAt(doc, frontiers);
 * console.log(forkedDoc.title.toString()); // "Hello"
 * console.log(doc.title.toString()); // "World"
 * ```
 */
export function forkAt<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  frontiers: Frontiers,
): TypedDoc<Shape> {
  const loroDoc = loro(doc).doc
  const forkedLoroDoc = loroDoc.forkAt(frontiers)
  const shape = loro(doc).docShape as Shape
  return createTypedDoc(shape, forkedLoroDoc)
}

/**
 * Creates a new TypedDoc at a specified version using a shallow snapshot.
 * Unlike `forkAt`, this creates a "garbage-collected" snapshot that only
 * contains the current state and history since the specified frontiers.
 *
 * This is more memory-efficient than `forkAt` for documents with long history,
 * especially useful for the fork-and-merge pattern in LEA where we only need:
 * 1. Read current state
 * 2. Apply changes
 * 3. Export delta and merge back
 *
 * The shallow fork has a different PeerID from the original by default.
 * Use `preservePeerId: true` to copy the original's peer ID (useful for
 * fork-and-merge patterns where you want consistent frontier progression).
 *
 * @param doc - The TypedDoc to fork
 * @param frontiers - The version to fork at (obtained from `loro(doc).doc.frontiers()`)
 * @param options - Optional settings
 * @param options.preservePeerId - If true, copies the original doc's peer ID to the fork
 * @returns A new TypedDoc with the same schema at the specified version (shallow)
 *
 * @example
 * ```typescript
 * import { shallowForkAt, loro } from "@loro-extended/change"
 *
 * const doc = createTypedDoc(schema);
 * doc.title.update("Hello");
 * const frontiers = loro(doc).doc.frontiers();
 *
 * // Create a shallow fork (memory-efficient)
 * const shallowDoc = shallowForkAt(doc, frontiers, { preservePeerId: true });
 *
 * // Modify the shallow doc
 * shallowDoc.title.update("World");
 *
 * // Merge changes back
 * const update = loro(shallowDoc).doc.export({
 *   mode: "update",
 *   from: loro(doc).doc.version()
 * });
 * loro(doc).doc.import(update);
 * ```
 */
export function shallowForkAt<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  frontiers: Frontiers,
  options?: { preservePeerId?: boolean },
): TypedDoc<Shape> {
  const loroDoc = loro(doc).doc
  const shape = loro(doc).docShape as Shape

  // Export a shallow snapshot at the specified frontiers
  const shallowBytes = loroDoc.export({
    mode: "shallow-snapshot",
    frontiers,
  })

  // Create a new LoroDoc from the shallow snapshot
  const shallowLoroDoc = LoroDoc.fromSnapshot(shallowBytes)

  // Optionally preserve the peer ID for consistent frontier progression
  if (options?.preservePeerId) {
    shallowLoroDoc.setPeerId(loroDoc.peerId)
  }

  return createTypedDoc(shape, shallowLoroDoc)
}
