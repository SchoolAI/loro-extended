import type {
  DocShape,
  Infer,
  PlainValueRef,
  TypedDoc,
} from "@loro-extended/change"
import type {
  AnyTypedRef,
  Lens,
  LensOptions,
  UseUndoManagerOptions,
  UseUndoManagerReturn,
} from "@loro-extended/hooks-core"
import {
  CursorRegistry,
  createCursorRegistryContext,
  createHooks,
  createRefHooks,
  createTextHooks,
  createUndoHooks,
} from "@loro-extended/hooks-core"
import * as React from "react"

// Create the cursor registry context for React
const { CursorRegistryContext, useCursorRegistry } =
  createCursorRegistryContext(React)

// Export the cursor registry context and hook
export { CursorRegistry, CursorRegistryContext, useCursorRegistry }

// Create core hooks
const coreHooks = createHooks(React)

export const {
  RepoContext,
  useRepo,
  useDocument,
  useEphemeral,
  useDocIdFromHash,
} = coreHooks

export function useLens<D extends DocShape>(
  world: TypedDoc<D>,
  options?: LensOptions,
): { lens: Lens<D>; doc: Infer<D> }
export function useLens<D extends DocShape, R>(
  world: TypedDoc<D>,
  options: LensOptions | undefined,
  selector: (doc: Infer<D>) => R,
): { lens: Lens<D>; doc: R }
export function useLens<D extends DocShape, R>(
  world: TypedDoc<D>,
  options?: LensOptions,
  selector?: (doc: Infer<D>) => R,
): { lens: Lens<D>; doc: R | Infer<D> } {
  const useLensInternal = coreHooks.useLens as <D extends DocShape, R>(
    world: TypedDoc<D>,
    options?: LensOptions,
    selector?: (doc: Infer<D>) => R,
  ) => { lens: Lens<D>; doc: R | Infer<D> }

  return useLensInternal(world, options, selector)
}

// Create ref hooks
const refHooks = createRefHooks(React)

// ============================================================================
// useValue - Explicit overloads to preserve type inference across packages
// ============================================================================

// Non-nullish overloads (most specific - must come FIRST)

/**
 * Subscribe to a PlainValueRef's value reactively.
 * Returns the value directly (not wrapped in an object).
 *
 * @param ref - A PlainValueRef
 * @returns The current plain value
 */
export function useValue<T>(ref: PlainValueRef<T>): T

/**
 * Subscribe to a ref's value reactively.
 * Returns the value directly (not wrapped in an object).
 *
 * @param ref - A typed ref (TextRef, ListRef, etc.)
 * @returns The current value from toJSON()
 */
export function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>

/**
 * Subscribe to a doc's value reactively.
 * Returns the full document snapshot.
 *
 * @param doc - A TypedDoc or Doc from useDocument
 * @returns The current document snapshot
 */
export function useValue<T extends TypedDoc<DocShape>>(
  doc: T,
): ReturnType<T["toJSON"]>

// Nullish overloads (less specific - must come AFTER non-nullish)

/** Handle undefined input - returns undefined. */
export function useValue(ref: undefined): undefined

/** Handle null input - returns null. */
export function useValue(ref: null): null

/** Subscribe to a PlainValueRef that may be undefined. */
export function useValue<T>(ref: PlainValueRef<T> | undefined): T | undefined

/** Subscribe to a PlainValueRef that may be null. */
export function useValue<T>(ref: PlainValueRef<T> | null): T | null

/** Subscribe to a TypedRef that may be undefined. */
export function useValue<R extends AnyTypedRef>(
  ref: R | undefined,
): ReturnType<R["toJSON"]> | undefined

/** Subscribe to a TypedRef that may be null. */
export function useValue<R extends AnyTypedRef>(
  ref: R | null,
): ReturnType<R["toJSON"]> | null

/** Subscribe to a TypedDoc that may be undefined. */
export function useValue<D extends DocShape>(
  doc: TypedDoc<D> | undefined,
): Infer<D> | undefined

/** Subscribe to a TypedDoc that may be null. */
export function useValue<D extends DocShape>(
  doc: TypedDoc<D> | null,
): Infer<D> | null

// Implementation delegates to the factory-created hook
export function useValue(refOrDoc: any): unknown {
  return refHooks.useValue(refOrDoc)
}

// ============================================================================
// usePlaceholder - Explicit overload to preserve type inference
// ============================================================================

/**
 * Get the placeholder value for a ref.
 *
 * @param ref - A typed ref (TextRef, ListRef, etc.)
 * @returns The placeholder value, or undefined if not set
 */
export function usePlaceholder<R extends AnyTypedRef>(
  ref: R,
): ReturnType<R["toJSON"]> | undefined {
  return refHooks.usePlaceholder(ref)
}

// Create text hooks with a stable getter that reads from a ref
// This avoids recreating the hooks on every render
const cursorRegistryRef = { current: null as CursorRegistry | null }

const textHooksWithRegistry = createTextHooks(React, {
  getCursorRegistry: () => cursorRegistryRef.current,
})

const undoHooksWithRegistry = createUndoHooks(React, {
  getCursorRegistry: () => cursorRegistryRef.current,
})

// Wrapper hook that updates the ref and delegates to the real hook
export function useCollaborativeText<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(
  textRef: Parameters<typeof textHooksWithRegistry.useCollaborativeText>[0],
  options?: Parameters<typeof textHooksWithRegistry.useCollaborativeText>[1],
) {
  // Get cursor registry from context and update the ref
  const cursorRegistry = useCursorRegistry()
  cursorRegistryRef.current = cursorRegistry

  return textHooksWithRegistry.useCollaborativeText<T>(textRef, options)
}

// Wrapper hook that updates the ref and delegates to the real hook
export function useUndoManager(
  doc: TypedDoc<DocShape>,
  namespaceOrOptions?: string | UseUndoManagerOptions,
  optionsArg?: UseUndoManagerOptions,
): UseUndoManagerReturn {
  // Get cursor registry from context and update the ref
  const cursorRegistry = useCursorRegistry()
  cursorRegistryRef.current = cursorRegistry

  return undoHooksWithRegistry.useUndoManager(
    doc,
    namespaceOrOptions,
    optionsArg,
  )
}
