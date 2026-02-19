import type { LoroEventBatch, Subscription } from "loro-crdt"
import { type ChangeOptions, serializeCommitMessage } from "./change-options.js"
import { createDiffOverlay } from "./diff-overlay.js"
import { EXT_SYMBOL, ext } from "./ext.js"
import { LORO_SYMBOL, loro } from "./loro.js"
import type { PathBuilder, PathSelector } from "./path-selector.js"
import { subscribeToPath } from "./path-subscription.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  RefMode,
  StructContainerShape,
  TreeRefInterface,
} from "./shape.js"
import { createTypedDoc, type TypedDoc } from "./typed-doc.js"
import { INTERNAL_SYMBOL, type TypedRef } from "./typed-refs/base.js"
import type { ListRef } from "./typed-refs/list-ref.js"
import type { MovableListRef } from "./typed-refs/movable-list-ref.js"
import type { IndexedRecordRef } from "./typed-refs/record-ref.js"
import type { StructRef } from "./typed-refs/struct-ref.js"
import type { TreeRef } from "./typed-refs/tree-ref.js"
import { createContainerTypedRef } from "./typed-refs/utils.js"

// Helper type to extract the draft type from an object with [EXT_SYMBOL].change()
type ExtractDraft<T> = T extends {
  [EXT_SYMBOL]: {
    change: (fn: (draft: infer D) => void, options?: ChangeOptions) => void
  }
}
  ? D
  : never

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
 * @param target - The TypedDoc, TypedRef, or any object with [EXT_SYMBOL].change() to mutate
 * @param fn - Function that performs mutations on the draft
 * @param options - Optional configuration including commit message
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
 * // With commit message for identity-based filtering
 * change(doc, draft => {
 *   draft.count.increment(10)
 * }, { commitMessage: { userId: "alice" } })
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
 *
 * // Lens example - works with any object that has [EXT_SYMBOL].change()
 * change(lens, draft => {
 *   draft.counter.increment(5)
 * }, { commitMessage: { playerId: "alice" } })
 * ```
 */
// NOTE: There is intentionally NO overload for TypedDoc<Shape> here.
// TypedDoc (and types that extend it like Doc<D, E>) are handled by the
// generic [EXT_SYMBOL] overload below, which extracts the draft type from
// the [EXT_SYMBOL].change signature. This works correctly for:
// - TypedDoc<D> directly
// - Doc<D, E> = TypedDoc<D> & { __ephemeralType?: E }
// - Any other intersection type extending TypedDoc

// Overload for TreeRef (special case - not a TypedRef<ContainerShape>)
export function change<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
  fn: (draft: TreeRef<DataShape>) => void,
  options?: ChangeOptions,
): TreeRef<DataShape>

// Overload for TreeRefInterface (the mutable type from TreeContainerShape)
export function change<DataShape extends StructContainerShape>(
  ref: TreeRefInterface<DataShape>,
  fn: (draft: TreeRefInterface<DataShape>) => void,
  options?: ChangeOptions,
): TreeRefInterface<DataShape>

// Overload for StructRef (special case - uses Proxy, not a class extending TypedRef)
// This must come before the generic TypedRef overload to match StructRef properly
// Note: The draft uses "draft" mode for ergonomic plain value access inside change()
export function change<
  NestedShapes extends Record<string, ContainerOrValueShape>,
  Mode extends RefMode = "mutable",
>(
  ref: StructRef<NestedShapes, Mode>,
  fn: (draft: StructRef<NestedShapes, "draft">) => void,
  options?: ChangeOptions,
): StructRef<NestedShapes, Mode>

// Overload for ListRef - draft uses "draft" mode for ergonomic element access
export function change<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
>(
  ref: ListRef<NestedShape, Mode>,
  fn: (draft: ListRef<NestedShape, "draft">) => void,
  options?: ChangeOptions,
): ListRef<NestedShape, Mode>

// Overload for MovableListRef - draft uses "draft" mode for ergonomic element access
export function change<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
>(
  ref: MovableListRef<NestedShape, Mode>,
  fn: (draft: MovableListRef<NestedShape, "draft">) => void,
  options?: ChangeOptions,
): MovableListRef<NestedShape, Mode>

// Overload for IndexedRecordRef - draft uses "draft" mode for ergonomic element access
export function change<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
>(
  ref: IndexedRecordRef<NestedShape, Mode>,
  fn: (draft: IndexedRecordRef<NestedShape, "draft">) => void,
  options?: ChangeOptions,
): IndexedRecordRef<NestedShape, Mode>

// Overload for TypedRef (all container refs) - preserves concrete ref type
export function change<T extends TypedRef<ContainerShape>>(
  ref: T,
  fn: (draft: T) => void,
  options?: ChangeOptions,
): T

// Generic overload for any object with [EXT_SYMBOL].change() (e.g., Lens)
// This enables change(lens, fn, options) without importing Lens type
// The draft type is extracted from the [EXT_SYMBOL].change signature
export function change<
  T extends {
    [EXT_SYMBOL]: {
      change: (fn: (draft: any) => void, options?: ChangeOptions) => void
    }
  },
>(target: T, fn: (draft: ExtractDraft<T>) => void, options?: ChangeOptions): T

// Implementation
export function change(
  target:
    | TypedDoc<any>
    | TypedRef<any>
    | TreeRef<any>
    | TreeRefInterface<any>
    | StructRef<any>
    | { [EXT_SYMBOL]: { change: unknown } },
  fn: (draft: any) => void,
  options?: ChangeOptions,
):
  | TypedDoc<any>
  | TypedRef<any>
  | TreeRef<any>
  | TreeRefInterface<any>
  | StructRef<any> {
  // Check if it's a TypedDoc or Lens by checking for EXT_SYMBOL with change method
  // This handles both TypedDoc and any object that implements [EXT_SYMBOL].change()
  const extNs = (target as any)[EXT_SYMBOL]
  if (extNs && "change" in extNs) {
    // It's a TypedDoc or Lens - use ext().change() with options
    return extNs.change(fn, options)
  }

  // It's a TypedRef or TreeRef - use ref-level change logic
  return changeRef(target as TypedRef<any> | TreeRef<any>, fn, options)
}

/**
 * Internal implementation for ref-level change.
 * Creates a draft ref with batchedMutation=true, executes the function,
 * absorbs changes, and commits.
 */
function changeRef<T extends TypedRef<any> | TreeRef<any>>(
  ref: T,
  fn: (draft: T) => void,
  options?: ChangeOptions,
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

  // Finalize the transaction (e.g., clear caches to prevent stale refs)
  const draftInternals = (draft as any)[INTERNAL_SYMBOL]
  draftInternals.finalizeTransaction?.()

  // Set commit message if provided
  const loroDoc = internals.getDoc()
  const serializedMessage = serializeCommitMessage(options?.commitMessage)
  if (serializedMessage) {
    loroDoc.setNextCommitMessage(serializedMessage)
  }

  // Commit the changes
  // Note: Loro's commit() is idempotent, so nested calls are safe
  loroDoc.commit()

  // Return the original ref for chaining
  return ref
}

// ============================================================================
// subscribe() function
// ============================================================================

/**
 * Subscribe to changes on a TypedDoc or TypedRef.
 *
 * @overload subscribe(doc, callback) - Subscribe to all document changes
 * @overload subscribe(doc, selector, callback) - Subscribe to path-selected changes with type inference
 * @overload subscribe(ref, callback) - Subscribe to a specific container's changes
 *
 * @example
 * ```typescript
 * import { subscribe, change } from "@loro-extended/change"
 *
 * // Whole document subscription
 * const unsubscribe = subscribe(doc, (event) => {
 *   console.log("Document changed:", event)
 * })
 *
 * // Path-selector subscription (type-safe!)
 * subscribe(doc, p => p.config.theme, (theme) => {
 *   console.log("Theme changed:", theme)  // theme is typed as string
 * })
 *
 * // Wildcard path returns array
 * subscribe(doc, p => p.books.$each.title, (titles) => {
 *   console.log("Book titles:", titles)  // titles is typed as string[]
 * })
 *
 * // Ref subscription - subscribes to specific container only
 * subscribe(doc.config, (event) => {
 *   console.log("Config changed")
 * })
 *
 * // Unsubscribe when done
 * unsubscribe()
 * ```
 */

// Overload 1: Whole document subscription (2 args, first is TypedDoc)
export function subscribe<D extends DocShape>(
  doc: TypedDoc<D>,
  callback: (event: LoroEventBatch) => void,
): () => void

// Overload 2: Path-selector subscription (3 args)
export function subscribe<D extends DocShape, R>(
  doc: TypedDoc<D>,
  selector: (p: PathBuilder<D>) => PathSelector<R>,
  callback: (value: R) => void,
): () => void

// Overload 3a: StructRef subscription
export function subscribe<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(
  ref: StructRef<NestedShapes>,
  callback: (event: LoroEventBatch) => void,
): () => void

// Overload 3b: TreeRef subscription
export function subscribe<DataShape extends StructContainerShape>(
  ref: TreeRef<DataShape>,
  callback: (event: LoroEventBatch) => void,
): () => void

// Overload 3c: TreeRefInterface subscription
export function subscribe<DataShape extends StructContainerShape>(
  ref: TreeRefInterface<DataShape>,
  callback: (event: LoroEventBatch) => void,
): () => void

// Overload 3d: Generic TypedRef subscription (2 args, first is TypedRef)
export function subscribe<Shape extends ContainerShape>(
  ref: TypedRef<Shape>,
  callback: (event: LoroEventBatch) => void,
): () => void

// Implementation
export function subscribe(
  target:
    | TypedDoc<any>
    | TypedRef<any>
    | StructRef<any>
    | TreeRef<any>
    | TreeRefInterface<any>,
  selectorOrCallback:
    | ((p: PathBuilder<any>) => PathSelector<any>)
    | ((event: LoroEventBatch) => void)
    | (() => void),
  callback?: ((value: any) => void) | ((event: LoroEventBatch) => void),
): () => void {
  // Detect which overload based on argument count and type
  const hasThreeArgs = callback !== undefined

  if (hasThreeArgs) {
    // Overload 2: Path-selector subscription (doc, selector, callback)
    const doc = target as TypedDoc<any>
    const selector = selectorOrCallback as (
      p: PathBuilder<any>,
    ) => PathSelector<any>
    const cb = callback as (value: any) => void
    return subscribeToPath(doc, selector, cb)
  }

  // Two arguments - need to distinguish between doc and ref
  const extNs = (target as any)[EXT_SYMBOL]
  const isDoc = extNs && "docShape" in extNs
  const isRef = LORO_SYMBOL in target && !isDoc

  if (isDoc) {
    // Overload 1: Whole document subscription
    // Access the LoroDoc directly via symbol to avoid type issues with TypedDoc<any>
    const loroDoc = (target as any)[LORO_SYMBOL]
    const cb = selectorOrCallback as (event: LoroEventBatch) => void
    const subscription: Subscription = loroDoc.subscribe(cb)
    return () => subscription()
  }

  if (isRef) {
    // Overload 3: Ref subscription
    // Access the Loro container directly via symbol to avoid type issues
    const loroContainer = (target as any)[LORO_SYMBOL]
    const cb = selectorOrCallback as (event: LoroEventBatch) => void
    // Loro containers have a subscribe method
    const subscription: Subscription = loroContainer.subscribe(cb)
    return () => subscription()
  }

  throw new Error(
    "subscribe() requires a TypedDoc or TypedRef. " +
      "Make sure you're passing a valid typed document or container reference.",
  )
}

export type Transition<Shape extends DocShape> = {
  before: TypedDoc<Shape>
  after: TypedDoc<Shape>
}

/**
 * Build a `{ before, after }` transition from a TypedDoc and a Loro event batch.
 * Uses a reverse diff overlay to compute the "before" view without checkout.
 * Throws on checkout events to avoid time-travel transitions.
 */
export function getTransition<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  event: LoroEventBatch,
): Transition<Shape> {
  if (event.by === "checkout") {
    throw new Error("getTransition does not support checkout events")
  }

  const loroDoc = loro(doc)
  const shape = ext(doc).docShape as Shape
  const overlay = createDiffOverlay(loroDoc, event)

  return {
    before: createTypedDoc(shape, { doc: loroDoc, overlay }),
    after: createTypedDoc(shape, { doc: loroDoc }),
  }
}
