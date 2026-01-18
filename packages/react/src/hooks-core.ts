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
export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } =
  createHooks(React)

// Create ref hooks
export const { useRefValue } = createRefHooks(React)

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
