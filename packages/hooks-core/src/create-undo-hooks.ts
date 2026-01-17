import type { DocShape } from "@loro-extended/change"
import type { EphemeralDeclarations, Handle } from "@loro-extended/repo"
import { UndoManager } from "loro-crdt"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"

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
 * Creates undo manager hooks for collaborative editing.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing useUndoManager hook
 */
export function createUndoHooks(framework: FrameworkHooks) {
  const { useMemo, useEffect, useCallback, useSyncExternalStore, useRef } =
    framework

  /**
   * Hook for managing undo/redo with Loro's UndoManager.
   * Automatically sets up keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y).
   *
   * @param handle - The document handle
   * @param options - Optional configuration
   * @returns Object with undo, redo functions and canUndo, canRedo state
   *
   * @example
   * ```tsx
   * function Editor({ handle }: { handle: Handle<DocSchema> }) {
   *   const { undo, redo, canUndo, canRedo } = useUndoManager(handle)
   *   return (
   *     <div>
   *       <button onClick={undo} disabled={!canUndo}>Undo</button>
   *       <button onClick={redo} disabled={!canRedo}>Redo</button>
   *     </div>
   *   )
   * }
   * ```
   */
  function useUndoManager(
    handle: Handle<DocShape, EphemeralDeclarations>,
    options?: UseUndoManagerOptions,
  ): UseUndoManagerReturn {
    const mergeInterval = options?.mergeInterval ?? 500
    const enableKeyboardShortcuts = options?.enableKeyboardShortcuts ?? true

    const undoManager = useMemo(() => {
      return new UndoManager(handle.loroDoc, {
        mergeInterval,
      })
    }, [handle.loroDoc, mergeInterval])

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
      const subscribeToSource = (onChange: () => void) => {
        return handle.loroDoc.subscribe(() => {
          const newState = computeValue()
          const current = cacheRef.current

          // Only notify if state actually changed
          if (
            !current ||
            newState.canUndo !== current.canUndo ||
            newState.canRedo !== current.canRedo
          ) {
            onChange()
          }
        })
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [handle.loroDoc, undoManager])

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
