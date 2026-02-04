/**
 * The `ext()` function - access loro-extended-specific features.
 *
 * Design Principle:
 * > `loro()` returns native Loro types directly (LoroDoc, LoroText, etc.)
 * > `ext()` provides loro-extended-specific features (fork, subscribe with jsonpath, etc.)
 *
 * For mutations, use the `change()` functional helper:
 * ```typescript
 * import { change, ext, loro } from "@loro-extended/change"
 *
 * // Mutations via change() functional helper
 * change(doc, draft => { draft.count.increment(10) })
 *
 * // Access native Loro types directly
 * const loroDoc = loro(doc)  // LoroDoc
 * const loroText = loro(doc.title)  // LoroText
 *
 * // Access loro-extended features
 * ext(doc).forkAt(frontiers)
 * ext(doc).subscribe(callback)
 * ext(ref).doc  // Get LoroDoc from any ref
 * ```
 */

import type {
  Container,
  LoroDoc,
  LoroEventBatch,
  Subscription,
} from "loro-crdt"
import type { JsonPatch } from "./json-patch.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  StructContainerShape,
  TreeRefInterface,
} from "./shape.js"
import type { Frontiers, TypedDoc } from "./typed-doc.js"
import type { TypedRef } from "./typed-refs/base.js"
import type { CounterRef } from "./typed-refs/counter-ref.js"
import type { ListRef } from "./typed-refs/list-ref.js"
import type { MovableListRef } from "./typed-refs/movable-list-ref.js"
import type { RecordRef } from "./typed-refs/record-ref.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TextRef } from "./typed-refs/text-ref.js"
import type { TreeNodeRef } from "./typed-refs/tree-node-ref.js"
import type { TreeRef } from "./typed-refs/tree-ref.js"
import type { Mutable } from "./types.js"

// ============================================================================
// Symbol for ext() access
// ============================================================================

/**
 * Well-known Symbol for ext() access.
 * This is exported so advanced users can access it directly if needed.
 */
export const EXT_SYMBOL = Symbol.for("loro-extended:ext")

// ============================================================================
// Interface definitions for ext() return types
// ============================================================================

/**
 * Base interface for all ext() return types on refs.
 * Provides access to the underlying LoroDoc and subscribe functionality.
 */
export interface ExtRefBase {
  /** The underlying LoroDoc */
  readonly doc: LoroDoc

  /**
   * Subscribe to container-level changes.
   * @param callback - Function called when the container changes
   * @returns Subscription that can be used to unsubscribe
   */
  subscribe(callback: (event: LoroEventBatch) => void): Subscription
}

/**
 * ext() return type for ListRef and MovableListRef.
 * Provides container operations that take Loro containers.
 */
export interface ExtListRef extends ExtRefBase {
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
 * ext() return type for StructRef and RecordRef.
 * Provides container operations that take Loro containers.
 */
export interface ExtMapRef extends ExtRefBase {
  /**
   * Set a Loro container at the specified key.
   * Use this when you need to set a pre-existing container.
   */
  setContainer(key: string, container: Container): Container
}

/**
 * ext() return type for TypedDoc.
 * Provides access to doc-level operations.
 */
export interface ExtDocRef<Shape extends DocShape> {
  /**
   * Creates a new TypedDoc as a fork of the current document.
   * The forked doc contains all history up to the current version.
   * The forked doc has a different PeerID from the original by default.
   *
   * @param options - Optional settings
   * @param options.preservePeerId - If true, copies the original doc's peer ID to the fork
   * @returns A new TypedDoc with the same schema at the current version
   */
  fork(options?: { preservePeerId?: boolean }): TypedDoc<Shape>

  /**
   * Creates a new TypedDoc at a specified version (frontiers).
   * The forked doc will only contain history before the specified frontiers.
   * The forked doc has a different PeerID from the original.
   *
   * @param frontiers - The version to fork at (obtained from `loro(doc).frontiers()`)
   * @returns A new TypedDoc with the same schema at the specified version
   */
  forkAt(frontiers: Frontiers): TypedDoc<Shape>

  /**
   * Creates a new TypedDoc at a specified version using a shallow snapshot.
   * Unlike `forkAt`, this creates a "garbage-collected" snapshot that only
   * contains the current state and history since the specified frontiers.
   *
   * @param frontiers - The version to fork at
   * @param options - Optional settings
   * @param options.preservePeerId - If true, copies the original doc's peer ID to the fork
   * @returns A new TypedDoc with the same schema at the specified version (shallow)
   */
  shallowForkAt(
    frontiers: Frontiers,
    options?: { preservePeerId?: boolean },
  ): TypedDoc<Shape>

  /**
   * Initialize the document by writing metadata.
   * This is called automatically unless `skipInitialize: true` was passed to createTypedDoc.
   * Call this manually if you skipped initialization and want to write metadata later.
   */
  initialize(): void

  /**
   * Apply JSON Patch operations to the document.
   * @param patch - Array of JSON Patch operations (RFC 6902)
   * @param pathPrefix - Optional path prefix for scoped operations
   */
  applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): void

  /** Access the document schema shape */
  readonly docShape: Shape

  /** Get raw CRDT value without placeholder overlay */
  readonly rawValue: unknown

  /**
   * Whether this document uses mergeable (flattened) storage.
   * This is the effective value computed from metadata > schema > false.
   */
  readonly mergeable: boolean

  /**
   * Subscribe to document-level changes.
   * @param callback - Function called when the document changes
   * @returns Subscription that can be used to unsubscribe
   */
  subscribe(callback: (event: LoroEventBatch) => void): Subscription

  /**
   * Batch mutations into a single transaction.
   * All changes commit together at the end.
   *
   * Note: The `change(doc, fn)` functional helper is the recommended API.
   * This method exists for internal use and method-chaining scenarios.
   *
   * @param fn - Function that performs mutations on the draft
   * @returns The same TypedDoc for chaining
   */
  change(fn: (draft: Mutable<Shape>) => void): TypedDoc<Shape>
}

// ============================================================================
// ext() function overloads
// ============================================================================

/**
 * Access loro-extended features for a ListRef.
 */
export function ext<NestedShape extends ContainerShape>(
  ref: ListRef<NestedShape>,
): ExtListRef

/**
 * Access loro-extended features for a MovableListRef.
 */
export function ext<NestedShape extends ContainerShape>(
  ref: MovableListRef<NestedShape>,
): ExtListRef

/**
 * Access loro-extended features for a StructRef.
 */
export function ext<NestedShapes extends Record<string, ContainerOrValueShape>>(
  ref: StructRef<NestedShapes>,
): ExtMapRef

/**
 * Access loro-extended features for a RecordRef.
 */
export function ext<NestedShape extends ContainerShape>(
  ref: RecordRef<NestedShape>,
): ExtMapRef

/**
 * Access loro-extended features for a TextRef.
 */
export function ext(ref: TextRef): ExtRefBase

/**
 * Access loro-extended features for a CounterRef.
 */
export function ext(ref: CounterRef): ExtRefBase

/**
 * Access loro-extended features for a TreeRef.
 */
export function ext<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape> | TreeRefInterface<DataShape>,
): ExtRefBase

/**
 * Access loro-extended features for a TreeNodeRef.
 */
export function ext<DataShape extends StructContainerShape>(
  ref: TreeNodeRef<DataShape>,
): ExtRefBase

/**
 * Access loro-extended features for a TypedDoc.
 */
export function ext<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
): ExtDocRef<Shape>

/**
 * Access loro-extended features for any TypedRef.
 */
export function ext<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
): ExtRefBase

/**
 * The `ext()` function - access loro-extended-specific features.
 *
 * Use this to access:
 * - fork(), forkAt(), shallowForkAt() for document forking
 * - initialize() for document initialization
 * - applyPatch() for JSON Patch operations
 * - docShape, rawValue, mergeable for document metadata
 * - subscribe() for change subscriptions
 * - pushContainer(), insertContainer(), setContainer() for container operations
 * - doc property to access LoroDoc from any ref
 *
 * For mutations, use the `change()` functional helper instead:
 * ```typescript
 * import { change } from "@loro-extended/change"
 * change(doc, draft => { draft.count.increment(10) })
 * ```
 *
 * @param refOrDoc - A TypedRef or TypedDoc
 * @returns An object with loro-extended features
 *
 * @example
 * ```typescript
 * import { change, ext, loro } from "@loro-extended/change"
 *
 * // Mutations via change() functional helper
 * change(doc, draft => { draft.count.increment(10) })
 *
 * // Document-level features
 * ext(doc).forkAt(frontiers)
 * ext(doc).subscribe(callback)
 *
 * // Ref-level features
 * ext(ref).doc  // Get LoroDoc from any ref
 * ext(list).pushContainer(loroMap)
 * ext(struct).setContainer('key', loroMap)
 * ```
 */
export function ext(
  refOrDoc:
    | TypedRef<any>
    | TypedDoc<any>
    | TreeRef<any>
    | TreeRefInterface<any>
    | TreeNodeRef<any>
    | StructRef<any>,
): ExtRefBase | ExtDocRef<any> {
  // Access the ext namespace via the well-known symbol
  const extNamespace = (refOrDoc as any)[EXT_SYMBOL]
  if (!extNamespace) {
    throw new Error(
      "Invalid argument: expected TypedRef, TreeRef, or TypedDoc with ext() support",
    )
  }
  return extNamespace
}
