import type {
  DocShape,
  Infer,
  LoroTextRef,
  TextRef,
} from "@loro-extended/change"
import { loro } from "@loro-extended/change"
import type {
  DocId,
  EphemeralDeclarations,
  Handle,
  HandleWithEphemerals,
  Repo,
  TypedEphemeral,
} from "@loro-extended/repo"
import { UndoManager } from "loro-crdt"

export interface FrameworkHooks {
  useState: <T>(
    initialState: T | (() => T),
  ) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  // biome-ignore lint/complexity/noBannedTypes: same as original
  useCallback: <T extends Function>(callback: T, deps: unknown[]) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T | null }
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ) => Snapshot
  useContext: <T>(context: any) => T
  createContext: <T>(defaultValue: T) => any
}

export function createHooks(framework: FrameworkHooks) {
  const {
    useState,
    useMemo,
    useRef,
    useSyncExternalStore,
    useContext,
    createContext,
  } = framework

  // ============================================
  // RepoContext & useRepo
  // ============================================

  const RepoContext = createContext<Repo | null>(null)

  function useRepo(): Repo {
    const repo = useContext(RepoContext)
    if (!repo) throw new Error("useRepo must be used within a RepoProvider")
    return repo as Repo
  }

  // ============================================
  // useHandle - Get typed handle (stable, never re-renders)
  // ============================================

  // Overload: without ephemeral stores
  function useHandle<D extends DocShape>(
    docId: DocId,
    docSchema: D,
  ): Handle<D, Record<string, never>>

  // Overload: with ephemeral stores (including presence)
  function useHandle<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes: E,
  ): HandleWithEphemerals<D, E>

  // Implementation
  function useHandle<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes?: E,
  ): HandleWithEphemerals<D, E> | Handle<D, Record<string, never>> {
    const repo = useRepo()

    // Synchronous initialization - no null state, no flickering
    const [handle] = useState(() => {
      if (ephemeralShapes) {
        return repo.get(docId, docSchema, ephemeralShapes)
      }
      return repo.get(docId, docSchema)
    })

    return handle as
      | HandleWithEphemerals<D, E>
      | Handle<D, Record<string, never>>
  }

  // ============================================
  // useDoc - Get document JSON snapshot (reactive)
  // ============================================

  // Overload: with selector (fine-grained)
  function useDoc<D extends DocShape, R>(
    handle: Handle<D, EphemeralDeclarations>,
    selector: (doc: Infer<D>) => R,
  ): R

  // Overload: without selector (full doc JSON)
  function useDoc<D extends DocShape>(
    handle: Handle<D, EphemeralDeclarations>,
  ): Infer<D>

  // Implementation
  function useDoc<D extends DocShape, R>(
    handle: Handle<D, EphemeralDeclarations>,
    selector?: (doc: Infer<D>) => R,
  ): R | Infer<D> {
    // Use a ref to cache the snapshot and track version
    const cacheRef = useRef<{
      version: number
      value: R | Infer<D>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      const computeValue = (): R | Infer<D> => {
        const json = handle.doc.toJSON()
        return selector ? selector(json) : json
      }

      // Initialize cache
      const version = handle.loroDoc.opCount()
      cacheRef.current = {
        version,
        value: computeValue(),
      }

      const subscribe = (onStoreChange: () => void) => {
        return handle.loroDoc.subscribe(() => {
          // Update cache on change
          const newVersion = handle.loroDoc.opCount()
          if (!cacheRef.current || cacheRef.current.version !== newVersion) {
            cacheRef.current = {
              version: newVersion,
              value: computeValue(),
            }
          }
          onStoreChange()
        })
      }

      const getSnapshot = (): R | Infer<D> => {
        const currentVersion = handle.loroDoc.opCount()
        if (!cacheRef.current || cacheRef.current.version !== currentVersion) {
          cacheRef.current = {
            version: currentVersion,
            value: computeValue(),
          }
        }
        if (!cacheRef.current) {
          throw new Error("useDoc: cache not initialized")
        }
        return cacheRef.current.value
      }

      return { subscribe, getSnapshot }
    }, [handle, selector])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  // ============================================
  // usePresence - Get presence state (reactive)
  // ============================================

  /**
   * Hook to get reactive presence state from a handle with a 'presence' ephemeral store.
   *
   * @deprecated Use `useEphemeral(handle.presence)` instead. The `usePresence` hook assumes
   * a hard-coded 'presence' store, but the unified ephemeral store model treats all stores
   * equally. Using `useEphemeral` directly is more flexible and explicit.
   *
   * @param handle - A handle with a 'presence' ephemeral store
   * @returns An object with `self` (your presence) and `peers` (others' presence)
   *
   * @example
   * ```tsx
   * // Deprecated:
   * const { self, peers } = usePresence(handle)
   *
   * // Preferred:
   * const { self, peers } = useEphemeral(handle.presence)
   * ```
   */
  function usePresence<P>(handle: { presence: TypedEphemeral<P> }): {
    self: P | undefined
    peers: Map<string, P>
  } {
    // Deprecation warning - only show once per session
    if (
      typeof globalThis !== "undefined" &&
      !(globalThis as Record<string, unknown>).__usePresenceDeprecationWarned
    ) {
      ;(globalThis as Record<string, unknown>).__usePresenceDeprecationWarned =
        true
      console.warn(
        "[loro-extended] usePresence is deprecated. Use useEphemeral(handle.presence) instead.",
      )
    }
    return useEphemeral(handle.presence)
  }

  // ============================================
  // useEphemeral - Get any ephemeral store state (reactive)
  // ============================================

  /**
   * Hook to get reactive state from any ephemeral store.
   *
   * @param ephemeral - A TypedEphemeral store
   * @returns An object with `self` (your value) and `peers` (others' values)
   *
   * @example
   * ```tsx
   * const handle = useHandle(docId, DocSchema, { mouse: MouseSchema })
   * const { self, peers } = useEphemeral(handle.mouse)
   * ```
   */
  function useEphemeral<T>(ephemeral: TypedEphemeral<T>): {
    self: T | undefined
    peers: Map<string, T>
  } {
    // Use a ref to cache the snapshot
    const cacheRef = useRef<{
      self: T | undefined
      peers: Map<string, T>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      const computeValue = () => ({
        self: ephemeral.self,
        peers: ephemeral.peers,
      })

      // Initialize cache
      cacheRef.current = computeValue()

      const subscribe = (onStoreChange: () => void) => {
        return ephemeral.subscribe(() => {
          // Update cache on change
          cacheRef.current = computeValue()
          onStoreChange()
        })
      }

      const getSnapshot = () => {
        // Return cached value - it's updated in subscribe callback
        if (!cacheRef.current) {
          cacheRef.current = computeValue()
        }
        return cacheRef.current
      }

      return { subscribe, getSnapshot }
    }, [ephemeral])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  // ============================================
  // Exports
  // ============================================

  return {
    RepoContext,
    useRepo,
    useHandle,
    useDoc,
    usePresence,
    useEphemeral,
  }
}

// ============================================
// Text Input Hooks
// ============================================

/**
 * Options for useCollaborativeText hook
 */
export interface UseCollaborativeTextOptions {
  /**
   * Called when a local change is made, before applying to the CRDT.
   * Return false to prevent the change.
   */
  onBeforeChange?: () => boolean | void
  /**
   * Called after a change is applied (local or remote).
   */
  onAfterChange?: () => void
}

/**
 * Return type for useCollaborativeText hook
 */
export interface UseCollaborativeTextReturn<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  /** Ref to attach to the input/textarea element */
  inputRef: { current: T | null }
  /** Event handlers to spread onto the input/textarea */
  handlers: {
    onBeforeInput: (e: InputEvent) => void
    onCompositionStart: () => void
    onCompositionEnd: (e: CompositionEvent) => void
  }
  /** Initial value for the input (use as defaultValue) */
  defaultValue: string
}

/**
 * Creates text input hooks for collaborative editing.
 * These hooks bind HTML input/textarea elements to LoroText containers.
 */
export function createTextHooks(framework: FrameworkHooks) {
  const { useRef, useEffect, useCallback, useMemo } = framework

  /**
   * Hook for binding an HTML input or textarea to a LoroText container.
   * Handles bidirectional sync with cursor position preservation.
   *
   * Note: For best performance, wrap `onBeforeChange` and `onAfterChange` callbacks
   * in `useCallback` to prevent unnecessary re-subscriptions.
   *
   * @param textRef - A TextRef from the typed document
   * @param options - Optional configuration
   * @returns Object with inputRef, event handlers, and defaultValue
   *
   * @example
   * ```tsx
   * function CollaborativeInput({ textRef }: { textRef: TextRef }) {
   *   const { inputRef, handlers, defaultValue } = useCollaborativeText(textRef)
   *   return (
   *     <input
   *       ref={inputRef}
   *       defaultValue={defaultValue}
   *       {...handlers}
   *     />
   *   )
   * }
   * ```
   */
  function useCollaborativeText<
    T extends HTMLInputElement | HTMLTextAreaElement,
  >(
    textRef: TextRef,
    options?: UseCollaborativeTextOptions,
  ): UseCollaborativeTextReturn<T> {
    const inputRef = useRef<T | null>(null)
    const isLocalChangeRef = useRef<boolean>(false)
    const lastKnownValueRef = useRef<string>(textRef.toString())
    const isComposingRef = useRef<boolean>(false)

    // Extract individual options to avoid re-subscriptions when options object changes
    const onBeforeChange = options?.onBeforeChange
    const onAfterChange = options?.onAfterChange

    // Memoize the loro namespace to prevent recreation on every render
    // This is critical for subscription stability
    const loroRef = useMemo(() => loro(textRef) as LoroTextRef, [textRef])

    // Subscribe to remote changes
    // Note: loroRef is derived from textRef, so we only need textRef in deps
    useEffect(() => {
      const unsubscribe = loroRef.subscribe(() => {
        // Skip if this is a local change
        if (isLocalChangeRef.current) return

        const input = inputRef.current
        if (!input) return

        const newValue = textRef.toString()
        if (newValue === lastKnownValueRef.current) return

        // Save cursor position before update
        const cursorStart = input.selectionStart ?? 0
        const cursorEnd = input.selectionEnd ?? 0
        const oldLength = lastKnownValueRef.current?.length ?? 0

        // Update the input value
        input.value = newValue
        lastKnownValueRef.current = newValue

        // Adjust cursor position based on length change
        // Note: This is a simplified approach that assumes changes happen at the end.
        // For more accurate cursor tracking with concurrent edits, you would need
        // to analyze the actual delta operations from Loro.
        const lengthDiff = newValue.length - oldLength
        const newCursorStart = Math.max(
          0,
          Math.min(cursorStart + lengthDiff, newValue.length),
        )
        const newCursorEnd = Math.max(
          0,
          Math.min(cursorEnd + lengthDiff, newValue.length),
        )

        input.setSelectionRange(newCursorStart, newCursorEnd)

        onAfterChange?.()
      })

      return unsubscribe
    }, [textRef, loroRef, onAfterChange])

    const handleBeforeInput = useCallback(
      (e: InputEvent) => {
        // Don't intercept during IME composition
        if (isComposingRef.current) return

        const { inputType, data } = e

        // Handle undefined inputType (can happen in some browsers/scenarios)
        if (!inputType) {
          console.warn("[useCollaborativeText] Unhandled inputType: undefined")
          return
        }

        // Handle historyUndo/historyRedo BEFORE preventDefault
        // Let browser handle these when UndoManager is not being used
        if (inputType === "historyUndo" || inputType === "historyRedo") {
          // Don't prevent default - let browser or UndoManager handle it
          return
        }

        // Now we can safely prevent default for all other input types
        e.preventDefault()

        // Check if change should be allowed
        if (onBeforeChange?.() === false) return

        const input = e.target as T
        const start = input.selectionStart ?? 0
        const end = input.selectionEnd ?? 0

        isLocalChangeRef.current = true

        try {
          switch (inputType) {
            case "insertText":
            case "insertFromPaste":
            case "insertFromDrop":
              // Delete selected text first, then insert
              if (start !== end) {
                textRef.delete(start, end - start)
              }
              if (data) {
                textRef.insert(start, data)
              }
              break

            case "insertLineBreak":
            case "insertParagraph":
              // Delete selected text first, then insert newline
              if (start !== end) {
                textRef.delete(start, end - start)
              }
              textRef.insert(start, "\n")
              break

            case "deleteContentBackward":
              // Backspace key
              if (start !== end) {
                textRef.delete(start, end - start)
              } else if (start > 0) {
                textRef.delete(start - 1, 1)
              }
              break

            case "deleteContentForward":
              // Delete key
              if (start !== end) {
                textRef.delete(start, end - start)
              } else if (start < input.value.length) {
                textRef.delete(start, 1)
              }
              break

            case "deleteByCut":
              // Cut operation
              if (start !== end) {
                textRef.delete(start, end - start)
              }
              break

            case "deleteWordBackward":
            case "deleteWordForward":
            case "deleteSoftLineBackward":
            case "deleteSoftLineForward":
            case "deleteHardLineBackward":
            case "deleteHardLineForward": {
              // For word/line deletions, use getTargetRanges() if available
              const ranges = e.getTargetRanges()
              if (ranges.length > 0) {
                const range = ranges[0]
                // Get the actual offsets from the range
                const deleteStart = range.startOffset
                const deleteEnd = range.endOffset
                if (deleteEnd > deleteStart) {
                  textRef.delete(deleteStart, deleteEnd - deleteStart)
                }
              } else if (start !== end) {
                // Fallback: delete selection
                textRef.delete(start, end - start)
              }
              break
            }

            default:
              // For unhandled input types, log a warning
              console.warn(
                `[useCollaborativeText] Unhandled inputType: ${inputType}`,
              )
          }

          // Update local tracking
          lastKnownValueRef.current = textRef.toString()

          // Update input value and cursor position
          input.value = lastKnownValueRef.current

          // Calculate new cursor position
          let newCursor: number
          if (inputType.startsWith("delete")) {
            newCursor = start !== end ? start : Math.max(0, start - 1)
          } else {
            newCursor = start + (data?.length ?? 1)
          }
          newCursor = Math.min(newCursor, input.value.length)

          input.setSelectionRange(newCursor, newCursor)

          onAfterChange?.()
        } finally {
          isLocalChangeRef.current = false
        }
      },
      [textRef, onBeforeChange, onAfterChange],
    )

    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true
    }, [])

    const handleCompositionEnd = useCallback(
      (e: CompositionEvent) => {
        isComposingRef.current = false

        // The composition has ended - the text is already in the input
        // We need to sync it to the CRDT
        const input = e.target as T
        const currentValue = input.value
        const oldValue = lastKnownValueRef.current ?? ""

        if (currentValue === oldValue) return

        // Check if change should be allowed
        if (onBeforeChange?.() === false) {
          // Revert the input
          input.value = oldValue
          return
        }

        isLocalChangeRef.current = true

        try {
          // Find where the composition occurred and update the CRDT
          // For simplicity, we'll use the update() method which replaces all text
          // A more sophisticated approach would diff the strings
          textRef.update(currentValue)
          lastKnownValueRef.current = currentValue

          onAfterChange?.()
        } finally {
          isLocalChangeRef.current = false
        }
      },
      [textRef, onBeforeChange, onAfterChange],
    )

    return {
      inputRef: inputRef as { current: T | null },
      handlers: {
        onBeforeInput: handleBeforeInput as (e: InputEvent) => void,
        onCompositionStart: handleCompositionStart,
        onCompositionEnd: handleCompositionEnd,
      },
      defaultValue: textRef.toString(),
    }
  }

  return { useCollaborativeText }
}

// ============================================
// Undo Manager Hooks
// ============================================

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

    // Track undo/redo state reactively - must cache to avoid infinite loop
    const initialState = { canUndo: false, canRedo: false }
    const stateRef = useRef(initialState)

    const store = useMemo(() => {
      // Initialize the cache
      stateRef.current = {
        canUndo: undoManager.canUndo(),
        canRedo: undoManager.canRedo(),
      }

      const subscribe = (onStoreChange: () => void) => {
        // Subscribe to document changes to update undo/redo state
        return handle.loroDoc.subscribe(() => {
          const newCanUndo = undoManager.canUndo()
          const newCanRedo = undoManager.canRedo()
          const current = stateRef.current

          if (
            current &&
            (newCanUndo !== current.canUndo || newCanRedo !== current.canRedo)
          ) {
            stateRef.current = { canUndo: newCanUndo, canRedo: newCanRedo }
            onStoreChange()
          }
        })
      }

      const getSnapshot = (): { canUndo: boolean; canRedo: boolean } => {
        // IMPORTANT: Must return cached value to avoid infinite loop
        // The cache is updated in the subscribe callback
        return stateRef.current ?? initialState
      }

      return { subscribe, getSnapshot }
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
