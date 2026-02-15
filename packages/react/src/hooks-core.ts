import type { DocShape, Infer, TypedDoc } from "@loro-extended/change"
import type { Lens, LensOptions } from "@loro-extended/hooks-core"
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

// New API (recommended)
export const { RepoContext, useRepo, useDocument, useEphemeral } = coreHooks

// Deprecated (still exported for backward compatibility)
export const { useHandle, useDoc } = coreHooks

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

// New API (recommended)
export const { useValue, usePlaceholder } = refHooks

// Deprecated (still exported for backward compatibility)
export const { useRefValue } = refHooks

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
  handle: Parameters<typeof undoHooksWithRegistry.useUndoManager>[0],
  namespaceOrOptions?: Parameters<
    typeof undoHooksWithRegistry.useUndoManager
  >[1],
  optionsArg?: Parameters<typeof undoHooksWithRegistry.useUndoManager>[2],
) {
  // Get cursor registry from context and update the ref
  const cursorRegistry = useCursorRegistry()
  cursorRegistryRef.current = cursorRegistry

  return undoHooksWithRegistry.useUndoManager(
    handle,
    namespaceOrOptions,
    optionsArg,
  )
}
