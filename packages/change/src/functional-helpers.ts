import type { LoroEventBatch } from "loro-crdt"
import { type ChangeOptions, serializeCommitMessage } from "./change-options.js"
import { createDiffOverlay } from "./diff-overlay.js"
import { EXT_SYMBOL, ext } from "./ext.js"
import { loro } from "./loro.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  StructContainerShape,
  TreeRefInterface,
} from "./shape.js"
import { createTypedDoc, type TypedDoc } from "./typed-doc.js"
import { INTERNAL_SYMBOL, type TypedRef } from "./typed-refs/base.js"
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
export function change<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(
  ref: StructRef<NestedShapes>,
  fn: (draft: StructRef<NestedShapes>) => void,
  options?: ChangeOptions,
): StructRef<NestedShapes>

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

  // Absorb any cached plain values back into the Loro containers
  const draftInternals = (draft as any)[INTERNAL_SYMBOL]
  draftInternals.absorbPlainValues()

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
