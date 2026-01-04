/**
 * The `loro()` function - single escape hatch for CRDT internals.
 *
 * Design Principle:
 * > If it takes a plain JavaScript value, keep it on the ref.
 * > If it takes a Loro container or exposes CRDT internals, move to `loro()`.
 *
 * @example
 * ```typescript
 * import { loro } from "@loro-extended/change"
 *
 * // Access underlying LoroDoc
 * loro(ref).doc
 *
 * // Access underlying Loro container (correctly typed)
 * loro(ref).container  // LoroList, LoroMap, LoroText, etc.
 *
 * // Subscribe to changes
 * loro(ref).subscribe(callback)
 *
 * // Container operations
 * loro(list).pushContainer(loroMap)
 * loro(struct).setContainer('key', loroMap)
 * ```
 */

import type {
  Container,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  Subscription,
} from "loro-crdt"
import type { JsonPatch } from "./json-patch.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  StructContainerShape,
} from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { CounterRef } from "./typed-refs/counter-ref.js"
import type { ListRef } from "./typed-refs/list-ref.js"
import type { MovableListRef } from "./typed-refs/movable-list-ref.js"
import type { RecordRef } from "./typed-refs/record-ref.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TextRef } from "./typed-refs/text-ref.js"
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
// Interface definitions for loro() return types
// ============================================================================

/**
 * Base interface for all loro() return types.
 * Provides access to the underlying LoroDoc, container, and subscription.
 */
export interface LoroRefBase {
  /** The underlying LoroDoc */
  readonly doc: LoroDoc

  /** The underlying Loro container */
  readonly container: unknown

  /**
   * Subscribe to container-level changes.
   * @param callback - Function called when the container changes
   * @returns Subscription that can be used to unsubscribe
   */
  subscribe(callback: (event: unknown) => void): Subscription
}

/**
 * loro() return type for ListRef and MovableListRef.
 * Provides container operations that take Loro containers.
 */
export interface LoroListRef extends LoroRefBase {
  /** The underlying LoroList or LoroMovableList */
  readonly container: LoroList | LoroMovableList

  /**
   * Push a Loro container to the end of the list.
   * Use this when you need to add a pre-existing container.
   */
  pushContainer(container: Container): Container

  /**
   * Insert a Loro container at the specified index.
   * Use this when you need to insert a pre-existing container.
   */
  insertContainer(index: number, container: Container): Container
}

/**
 * loro() return type for StructRef and RecordRef.
 * Provides container operations that take Loro containers.
 */
export interface LoroMapRef extends LoroRefBase {
  /** The underlying LoroMap */
  readonly container: LoroMap

  /**
   * Set a Loro container at the specified key.
   * Use this when you need to set a pre-existing container.
   */
  setContainer(key: string, container: Container): Container
}

/**
 * loro() return type for TextRef.
 */
export interface LoroTextRef extends LoroRefBase {
  /** The underlying LoroText */
  readonly container: LoroText
}

/**
 * loro() return type for CounterRef.
 */
export interface LoroCounterRef extends LoroRefBase {
  /** The underlying LoroCounter */
  readonly container: LoroCounter
}

/**
 * loro() return type for TreeRef.
 */
export interface LoroTreeRef extends LoroRefBase {
  /** The underlying LoroTree */
  readonly container: LoroTree
}

/**
 * loro() return type for TypedDoc.
 * Provides access to doc-level operations.
 */
export interface LoroTypedDocRef extends LoroRefBase {
  /** The underlying LoroDoc (same as doc for TypedDoc) */
  readonly container: LoroDoc

  /**
   * Apply JSON Patch operations to the document.
   * @param patch - Array of JSON Patch operations (RFC 6902)
   * @param pathPrefix - Optional path prefix for scoped operations
   */
  applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): void

  /** Access the document schema shape */
  readonly docShape: DocShape

  /** Get raw CRDT value without placeholder overlay */
  readonly rawValue: unknown
}

// ============================================================================
// loro() function overloads
// ============================================================================

/**
 * Access CRDT internals for a ListRef.
 */
export function loro<NestedShape extends ContainerShape>(
  ref: ListRef<NestedShape>,
): LoroListRef

/**
 * Access CRDT internals for a MovableListRef.
 */
export function loro<NestedShape extends ContainerShape>(
  ref: MovableListRef<NestedShape>,
): LoroListRef

/**
 * Access CRDT internals for a StructRef.
 */
export function loro<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(ref: StructRef<NestedShapes>): LoroMapRef

/**
 * Access CRDT internals for a RecordRef.
 */
export function loro<NestedShape extends ContainerShape>(
  ref: RecordRef<NestedShape>,
): LoroMapRef

/**
 * Access CRDT internals for a TextRef.
 */
export function loro(ref: TextRef): LoroTextRef

/**
 * Access CRDT internals for a CounterRef.
 */
export function loro(ref: CounterRef): LoroCounterRef

/**
 * Access CRDT internals for a TreeRef.
 */
export function loro<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
): LoroTreeRef

/**
 * Access CRDT internals for a TypedDoc.
 */
export function loro<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
): LoroTypedDocRef

/**
 * Access CRDT internals for any TypedRef.
 */
export function loro<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): LoroRefBase

/**
 * The `loro()` function - single escape hatch for CRDT internals.
 *
 * Use this to access:
 * - The underlying LoroDoc
 * - The underlying Loro container (correctly typed)
 * - Container-level subscriptions
 * - Container operations that take Loro containers (pushContainer, setContainer, etc.)
 *
 * @param refOrDoc - A TypedRef or TypedDoc
 * @returns An object with CRDT internals and operations
 *
 * @example
 * ```typescript
 * import { loro } from "@loro-extended/change"
 *
 * // Access underlying LoroDoc
 * loro(doc.settings).doc
 *
 * // Access underlying Loro container
 * loro(doc.items).container  // LoroList
 *
 * // Subscribe to changes
 * loro(doc.settings).subscribe(event => { ... })
 *
 * // Container operations
 * loro(doc.items).pushContainer(loroMap)
 * ```
 */
export function loro(
  refOrDoc: TypedRef<any> | TypedDoc<any> | TreeRef<any> | StructRef<any>,
): LoroRefBase {
  // Access the loro namespace via the well-known symbol
  const loroNamespace = (refOrDoc as any)[LORO_SYMBOL]
  if (!loroNamespace) {
    throw new Error(
      "Invalid argument: expected TypedRef, TreeRef, or TypedDoc with loro() support",
    )
  }
  return loroNamespace
}
