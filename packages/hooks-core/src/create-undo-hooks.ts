import type { DocShape, TypedDoc } from "@loro-extended/change"
import { loro } from "@loro-extended/change"
import type { Cursor } from "loro-crdt"
import { UndoManager } from "loro-crdt"
import type { CursorRegistry } from "./cursor-registry"
import type { FrameworkHooks } from "./types"
import {
  NAMESPACE_ORIGIN_PREFIX,
  type UndoManagerRegistry,
} from "./undo-manager-registry"
import { createSyncStore } from "./utils/create-sync-store"

/**
 * Cursor position information for undo/redo restoration
 */
export interface CursorPosition {
  /** The Loro Cursor object for stable position tracking */
  cursor: Cursor
  /** Optional: which end of a selection this represents */
  side?: "start" | "end"
}

/**
 * Options for useUndoManager hook
 */
export interface UseUndoManagerOptions {
  /**
   * Time in milliseconds to merge consecutive changes into a single undo step.
   * Default: 500ms
   */
  mergeInterval?: number
  /**
   * Whether to set up keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y).
   * Default: true
   */
  enableKeyboardShortcuts?: boolean
  /**
   * Callback to get current cursor positions before an undo/redo step is pushed.
   * Return an array of Cursor objects representing current selection/cursor positions.
   * These will be stored with the undo step and restored when popped.
   *
   * Note: When using automatic cursor restoration via CursorRegistry, this callback
   * is not needed - the registry handles cursor tracking automatically.
   */
  getCursors?: () => Cursor[]
  /**
   * Callback to restore cursor positions after an undo/redo step is popped.
   * Receives the resolved cursor positions (as indices) that were stored with the step.
   *
   * Note: When using automatic cursor restoration via CursorRegistry, this callback
   * is not needed - the registry handles cursor restoration automatically.
   */
  setCursors?: (positions: Array<{ offset: number; side: -1 | 0 | 1 }>) => void
}

/**
 * Return type for useUndoManager hook
 */
export interface UseUndoManagerReturn {
  /** Undo the last change */
  undo: () => void
  /** Redo the last undone change */
  redo: () => void
  /** Whether there are changes to undo */
  canUndo: boolean
  /** Whether there are changes to redo */
  canRedo: boolean
  /** The underlying UndoManager instance */
  undoManager: UndoManager
}

/**
 * Configuration for createUndoHooks factory
 */
export interface CreateUndoHooksConfig {
  /**
   * Function to get the cursor registry from context.
   * If provided, cursor restoration will be automatic.
   */
  getCursorRegistry?: () => CursorRegistry | null
  /**
   * Function to get the undo manager registry from context.
   * If provided, namespace-based undo will be supported.
   */
  getUndoManagerRegistry?: () => UndoManagerRegistry | null
}

/**
 * Creates undo manager hooks for collaborative editing.
 *
 * @param framework - Framework-specific hook implementations
 * @param config - Optional configuration for cursor registry integration
 * @returns Object containing useUndoManager hook
 */
export function createUndoHooks(
  framework: FrameworkHooks,
  config?: CreateUndoHooksConfig,
) {
  const { useMemo, useEffect, useCallback, useSyncExternalStore, useRef } =
    framework
  const getCursorRegistry = config?.getCursorRegistry
  const getUndoManagerRegistry = config?.getUndoManagerRegistry

  /**
   * Hook for managing undo/redo with Loro's UndoManager.
   * Automatically sets up keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y).
   *
   * @param doc - The document (TypedDoc or Doc from repo.get())
   * @param namespaceOrOptions - Optional namespace string or options object
   * @param options - Optional configuration (when namespace is provided as second arg)
   * @returns Object with undo, redo functions and canUndo, canRedo state
   *
   * @example
   * ```tsx
   * // Basic usage with Doc
   * function Editor({ doc }: { doc: Doc<DocSchema> }) {
   *   const { undo, redo, canUndo, canRedo } = useUndoManager(doc)
   *   return (
   *     <div>
   *       <button onClick={undo} disabled={!canUndo}>Undo</button>
   *       <button onClick={redo} disabled={!canRedo}>Redo</button>
   *     </div>
   *   )
   * }
   *
   * // With namespace for scoped undo
   * function HeaderEditor({ doc }: { doc: Doc<DocSchema> }) {
   *   const { undo, redo } = useUndoManager(doc, "header")
   *   // This undo only affects changes made with undoNamespace="header"
   * }
   * ```
   */
  function useUndoManager(
    doc: TypedDoc<DocShape>,
    namespaceOrOptions?: string | UseUndoManagerOptions,
    optionsArg?: UseUndoManagerOptions,
  ): UseUndoManagerReturn {
    // Get the LoroDoc from TypedDoc
    const loroDoc = useMemo(() => loro(doc), [doc])

    // Parse arguments - support both (doc, options) and (doc, namespace, options)
    const namespace =
      typeof namespaceOrOptions === "string" ? namespaceOrOptions : undefined
    const options =
      typeof namespaceOrOptions === "object" ? namespaceOrOptions : optionsArg

    const mergeInterval = options?.mergeInterval ?? 500
    const enableKeyboardShortcuts = options?.enableKeyboardShortcuts ?? true
    const getCursorsOption = options?.getCursors
    const setCursorsOption = options?.setCursors

    // Get registries (may be null if no provider)
    // Note: getCursorRegistry is called via a getter function so it always gets the latest value
    const undoManagerRegistry = getUndoManagerRegistry?.()

    // Calculate excludeOriginPrefixes for namespace isolation
    const excludeOriginPrefixes = useMemo(() => {
      if (!namespace && !undoManagerRegistry) {
        return undefined
      }

      // Get all registered namespaces and exclude them (except our own)
      const prefixes: string[] = []
      if (undoManagerRegistry) {
        for (const ns of undoManagerRegistry.getAllNamespaces()) {
          if (ns !== namespace && ns !== undefined) {
            prefixes.push(`${NAMESPACE_ORIGIN_PREFIX}${ns}`)
          }
        }
      }

      return prefixes.length > 0 ? prefixes : undefined
    }, [namespace, undoManagerRegistry])

    // Create stable onPush callback that stores cursor AND container ID
    // We use the getter function pattern so the callback always gets the latest registry
    const onPush = useMemo(() => {
      // If user provided getCursors, use that
      if (getCursorsOption) {
        return () => {
          const cursors = getCursorsOption()
          return { value: null, cursors }
        }
      }

      // If we have a cursor registry getter, use automatic cursor tracking
      if (getCursorRegistry) {
        return () => {
          const cursorRegistry = getCursorRegistry()
          if (!cursorRegistry) {
            return { value: null, cursors: [] }
          }

          const focused = cursorRegistry.getFocused()
          if (!focused) {
            return { value: null, cursors: [] }
          }

          // Get cursor position from the focused element
          const element = focused.element
          const start = element.selectionStart ?? 0

          // Create a Loro cursor at the current position
          const loroText = loroDoc.getText(focused.containerId)
          if (!loroText || start > loroText.length) {
            return { value: null, cursors: [] }
          }

          const cursor = loroText.getCursor(start, 0)
          if (!cursor) {
            return { value: null, cursors: [] }
          }

          // Store the container ID with the cursor for restoration
          return {
            value: { containerId: focused.containerId },
            cursors: [cursor],
          }
        }
      }

      return undefined
    }, [getCursorsOption, getCursorRegistry, loroDoc])

    // Create stable onPop callback that restores cursor to the correct element
    // We use the getter function pattern so the callback always gets the latest registry
    const onPop = useMemo(() => {
      // If user provided setCursors, use that
      if (setCursorsOption) {
        return (
          _isUndo: boolean,
          meta: { value: unknown; cursors: Cursor[] },
        ) => {
          const positions: Array<{ offset: number; side: -1 | 0 | 1 }> = []
          for (const cursor of meta.cursors) {
            const pos = loroDoc.getCursorPos(cursor)
            if (pos) {
              positions.push({ offset: pos.offset, side: pos.side })
            }
          }
          if (positions.length > 0) {
            setCursorsOption(positions)
          }
        }
      }

      // If we have a cursor registry getter, use automatic cursor restoration
      if (getCursorRegistry) {
        return (
          _isUndo: boolean,
          meta: { value: unknown; cursors: Cursor[] },
        ) => {
          // Early return if no cursors to restore
          if (meta.cursors.length === 0) return

          // Get the container ID from the stored value
          const storedValue = meta.value as { containerId?: string } | null
          const containerId = storedValue?.containerId
          if (!containerId) return

          // Get the current cursor registry
          const cursorRegistry = getCursorRegistry()
          if (!cursorRegistry) return

          // Find the element for this container ID
          const registered = cursorRegistry.getElement(containerId)
          if (!registered) return

          // Resolve the cursor position
          const cursor = meta.cursors[0]
          const pos = loroDoc.getCursorPos(cursor)
          if (!pos) return

          // Restore cursor to the correct element
          const element = registered.element
          const offset = Math.min(pos.offset, element.value.length)
          element.setSelectionRange(offset, offset)
          element.focus()
        }
      }

      return undefined
    }, [setCursorsOption, getCursorRegistry, loroDoc])

    const undoManager = useMemo(() => {
      // If we have an undo manager registry, use it for namespace coordination
      if (undoManagerRegistry && namespace !== undefined) {
        return undoManagerRegistry.getOrCreate(namespace, {
          mergeInterval,
          onPush,
          onPop,
        })
      }

      // Otherwise create a standalone UndoManager
      return new UndoManager(loroDoc, {
        mergeInterval,
        excludeOriginPrefixes,
        onPush,
        onPop,
      })
    }, [
      loroDoc,
      mergeInterval,
      excludeOriginPrefixes,
      onPush,
      onPop,
      undoManagerRegistry,
      namespace,
    ])

    const undo = useCallback(() => {
      if (undoManager.canUndo()) {
        undoManager.undo()
      }
    }, [undoManager])

    const redo = useCallback(() => {
      if (undoManager.canRedo()) {
        undoManager.redo()
      }
    }, [undoManager])

    // Track undo/redo state reactively using createSyncStore
    const cacheRef = useRef<{ canUndo: boolean; canRedo: boolean } | null>(null)

    const store = useMemo(() => {
      // Compute the current undo/redo state
      const computeValue = () => ({
        canUndo: undoManager.canUndo(),
        canRedo: undoManager.canRedo(),
      })

      // Subscribe to document changes to update undo/redo state
      // Note: We always call onChange() and let createSyncStore handle caching.
      // The filtering logic was causing issues because it compared against
      // the old cache value before createSyncStore updated it.
      const subscribeToSource = (onChange: () => void) => {
        return loroDoc.subscribe(() => {
          onChange()
        })
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [loroDoc, undoManager])

    const { canUndo, canRedo } = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
    )

    // Set up keyboard shortcuts
    useEffect(() => {
      if (!enableKeyboardShortcuts) return

      const handleKeyDown = (e: KeyboardEvent) => {
        const isMod = e.metaKey || e.ctrlKey

        if (isMod && e.key === "z" && !e.shiftKey) {
          e.preventDefault()
          undo()
        } else if (isMod && e.key === "z" && e.shiftKey) {
          e.preventDefault()
          redo()
        } else if (isMod && e.key === "y") {
          e.preventDefault()
          redo()
        }
      }

      document.addEventListener("keydown", handleKeyDown)
      return () => document.removeEventListener("keydown", handleKeyDown)
    }, [enableKeyboardShortcuts, undo, redo])

    return { undo, redo, canUndo, canRedo, undoManager }
  }

  return { useUndoManager }
}
