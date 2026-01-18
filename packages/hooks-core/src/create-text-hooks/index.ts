import type { LoroTextRef, TextRef } from "@loro-extended/change"
import { getLoroDoc, loro } from "@loro-extended/change"
import type { Delta, LoroEventBatch, TextDiff } from "loro-crdt"
import type { CursorRegistry } from "../cursor-registry"
import type { FrameworkHooks } from "../types"
import { NAMESPACE_ORIGIN_PREFIX } from "../undo-manager-registry"
import { getPlaceholder, getRawTextValue } from "../utils/text-ref-helpers"
import { adjustSelectionFromDelta } from "./cursor-utils"
import { calculateNewCursor, inputHandlers } from "./input-handlers"

/**
 * Options for useCollaborativeText hook
 */
export interface UseCollaborativeTextOptions {
  /**
   * Called when a local change is made, before applying to the CRDT.
   * Return false to prevent the change.
   */
  onBeforeChange?: () => boolean | undefined
  /**
   * Called after a change is applied (local or remote).
   */
  onAfterChange?: () => void
  /**
   * Undo namespace for this text field.
   * When set, changes will be tagged with this namespace via setNextCommitOrigin,
   * allowing namespace-scoped undo/redo.
   */
  undoNamespace?: string
}

/**
 * Return type for useCollaborativeText hook
 */
export interface UseCollaborativeTextReturn<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  /**
   * Ref callback to attach to the input/textarea element.
   * This is a callback ref, not a ref object - pass it directly to the ref prop.
   */
  inputRef: (element: T | null) => void
  /**
   * Initial value for the input (use as defaultValue).
   * This is the raw CRDT value, which may be empty even if a placeholder is defined.
   */
  defaultValue: string
  /**
   * Placeholder text from the Shape definition, if any.
   * Use this as the HTML placeholder attribute for proper UX.
   */
  placeholder?: string
}

/**
 * Configuration for createTextHooks factory
 */
export interface CreateTextHooksConfig {
  /**
   * Function to get the cursor registry from context.
   * If provided, elements will be auto-registered for cursor restoration.
   */
  getCursorRegistry?: () => CursorRegistry | null
}

/**
 * Creates text input hooks for collaborative editing.
 * These hooks bind HTML input/textarea elements to LoroText containers.
 *
 * @param framework - Framework-specific hook implementations
 * @param config - Optional configuration for cursor registry integration
 * @returns Object containing useCollaborativeText hook
 */
export function createTextHooks(
  framework: FrameworkHooks,
  config?: CreateTextHooksConfig,
) {
  const { useRef, useEffect, useMemo, useCallback } = framework
  const getCursorRegistry = config?.getCursorRegistry

  /**
   * Hook for binding an HTML input or textarea to a LoroText container.
   * Handles bidirectional sync with cursor position preservation.
   *
   * The hook uses a ref callback pattern to ensure proper initialization:
   * - When the element mounts, its value is synced FROM the CRDT
   * - Native event listeners are attached immediately
   * - Selection bounds are validated before any CRDT operation
   *
   * Note: For best performance, wrap `onBeforeChange` and `onAfterChange` callbacks
   * in `useCallback` to prevent unnecessary re-subscriptions.
   *
   * @param textRef - A TextRef from the typed document
   * @param options - Optional configuration
   * @returns Object with inputRef callback, event handlers, and defaultValue
   *
   * @example
   * ```tsx
   * function CollaborativeInput({ textRef }: { textRef: TextRef }) {
   *   const { inputRef, defaultValue } = useCollaborativeText(textRef)
   *   return (
   *     <input
   *       ref={inputRef}
   *       defaultValue={defaultValue}
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
    // Store the current element for access in effects
    const elementRef = useRef<T | null>(null)
    // Store cleanup function for event listeners
    const cleanupRef = useRef<(() => void) | null>(null)
    // Track if we're in the middle of a local change
    const isLocalChangeRef = useRef<boolean>(false)
    // Track the last known value to detect changes
    // IMPORTANT: Use raw CRDT value, not textRef.toString() which may return placeholder
    const lastKnownValueRef = useRef<string>(getRawTextValue(textRef))
    // Track IME composition state
    const isComposingRef = useRef<boolean>(false)

    // Extract individual options to avoid re-subscriptions when options object changes
    const onBeforeChange = options?.onBeforeChange
    const onAfterChange = options?.onAfterChange
    const undoNamespace = options?.undoNamespace

    // Memoize the loro namespace to prevent recreation on every render
    // This is critical for subscription stability
    const loroRef = useMemo(() => loro(textRef) as LoroTextRef, [textRef])

    // Get the LoroDoc for setting commit origin
    const loroDoc = useMemo(() => getLoroDoc(textRef), [textRef])

    // Helper to set the commit origin before changes when namespace is specified
    const setNamespaceOrigin = useCallback(() => {
      if (undoNamespace) {
        loroDoc.setNextCommitOrigin(
          `${NAMESPACE_ORIGIN_PREFIX}${undoNamespace}`,
        )
      }
    }, [loroDoc, undoNamespace])

    // Create stable handler references that always have the latest closure values
    const handleBeforeInputRef = useRef<(e: InputEvent) => void>(() => {})
    const handleCompositionStartRef = useRef<() => void>(() => {})
    const handleCompositionEndRef = useRef<(e: CompositionEvent) => void>(
      () => {},
    )

    // Update handler refs - these always have the latest closure values
    handleBeforeInputRef.current = (e: InputEvent) => {
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

      // Set the commit origin for namespace-based undo before making changes
      setNamespaceOrigin()

      const input = e.target as T

      // Get CRDT length for bounds validation
      // Use raw CRDT value to avoid placeholder confusion
      const crdtValue = getRawTextValue(textRef)
      const crdtLength = crdtValue.length

      // Clamp selection to valid bounds within the CRDT
      // This prevents "Index out of bound" errors when input has stale content
      const rawStart = input.selectionStart ?? 0
      const rawEnd = input.selectionEnd ?? 0
      const start = Math.min(Math.max(0, rawStart), crdtLength)
      const end = Math.min(Math.max(0, rawEnd), crdtLength)

      isLocalChangeRef.current = true

      try {
        // Look up the handler for this input type
        const handler = inputHandlers[inputType]

        if (handler) {
          handler({
            textRef,
            start,
            end,
            data,
            input,
            event: e,
          })
        } else {
          // For unhandled input types, log a warning
          console.warn(
            `[useCollaborativeText] Unhandled inputType: ${inputType}`,
          )
        }

        // Update local tracking with raw CRDT value
        lastKnownValueRef.current = getRawTextValue(textRef)

        // Update input value and cursor position
        input.value = lastKnownValueRef.current

        // Calculate new cursor position
        const newCursor = calculateNewCursor(
          inputType,
          start,
          end,
          data,
          input.value.length,
        )

        input.setSelectionRange(newCursor, newCursor)

        onAfterChange?.()
      } finally {
        isLocalChangeRef.current = false
      }
    }

    handleCompositionStartRef.current = () => {
      isComposingRef.current = true
    }

    handleCompositionEndRef.current = (e: CompositionEvent) => {
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

      // Set the commit origin for namespace-based undo before making changes
      setNamespaceOrigin()

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
    }

    // Ref callback that fires when element mounts/unmounts
    // This ensures proper initialization and event listener attachment
    const setInputRef = useCallback(
      (element: T | null) => {
        // Get cursor registry (may be null if no provider)
        const cursorRegistry = getCursorRegistry?.()

        // Cleanup previous element's listeners and registry
        if (cleanupRef.current) {
          cleanupRef.current()
          cleanupRef.current = null
        }

        elementRef.current = element

        if (element) {
          // CRITICAL: Sync input value FROM the raw CRDT immediately
          // Use getRawTextValue to avoid placeholder - the placeholder should be
          // shown via the HTML placeholder attribute, not as actual content
          const crdtValue = getRawTextValue(textRef)
          element.value = crdtValue
          lastKnownValueRef.current = crdtValue

          // Register with cursor registry if available
          if (cursorRegistry) {
            cursorRegistry.register(textRef, element, undoNamespace)
          }

          // Create event listener wrappers that delegate to refs
          // This allows the handlers to be updated without re-attaching listeners
          const onBeforeInput = (e: Event) => {
            handleBeforeInputRef.current?.(e as InputEvent)
          }
          const onCompositionStart = () => {
            handleCompositionStartRef.current?.()
          }
          const onCompositionEnd = (e: Event) => {
            handleCompositionEndRef.current?.(e as CompositionEvent)
          }

          // Focus/blur handlers for cursor registry
          const onFocus = () => {
            cursorRegistry?.setFocused(textRef)
          }
          const onBlur = () => {
            // Only clear focus if this element was the focused one
            const focused = cursorRegistry?.getFocused()
            if (focused?.element === element) {
              cursorRegistry?.setFocused(null)
            }
          }

          // Attach native event listeners
          // We use native listeners because React's synthetic events don't provide
          // the full InputEvent API (e.g., inputType is undefined in React)
          element.addEventListener("beforeinput", onBeforeInput)
          element.addEventListener("compositionstart", onCompositionStart)
          element.addEventListener("compositionend", onCompositionEnd)
          element.addEventListener("focus", onFocus)
          element.addEventListener("blur", onBlur)

          // Store cleanup function
          cleanupRef.current = () => {
            element.removeEventListener("beforeinput", onBeforeInput)
            element.removeEventListener("compositionstart", onCompositionStart)
            element.removeEventListener("compositionend", onCompositionEnd)
            element.removeEventListener("focus", onFocus)
            element.removeEventListener("blur", onBlur)

            // Unregister from cursor registry
            if (cursorRegistry) {
              cursorRegistry.unregister(textRef)
            }
          }
        }
      },
      [textRef, undoNamespace, getCursorRegistry],
    )

    // Subscribe to remote changes and undo/redo events
    useEffect(() => {
      const unsubscribe = loroRef.subscribe((rawEvent: unknown) => {
        // Cast to LoroEventBatch to access event properties
        const event = rawEvent as LoroEventBatch
        // Skip if we're in the middle of processing a local input event.
        // We use isLocalChangeRef instead of event.by === "local" because:
        // - isLocalChangeRef is only true during our beforeinput handler
        // - event.by === "local" is true for BOTH user input AND undo/redo operations
        // - We need to update the textarea for undo/redo, so we can't filter on event.by
        if (isLocalChangeRef.current) return
        // Also skip if this is a local change that we didn't initiate (e.g., from another hook)
        // but only if the value hasn't actually changed
        void event // Keep event in scope for future use (e.g., delta-based cursor adjustment)

        const input = elementRef.current
        if (!input) return

        // Use raw CRDT value to avoid placeholder confusion
        const newValue = getRawTextValue(textRef)
        if (newValue === lastKnownValueRef.current) return

        // Save cursor position before update
        const cursorStart = input.selectionStart ?? 0
        const cursorEnd = input.selectionEnd ?? 0

        // Update the input value
        input.value = newValue
        lastKnownValueRef.current = newValue

        // Extract delta from the event for accurate cursor adjustment
        // The event contains TextDiff with delta operations
        let newCursorStart = cursorStart
        let newCursorEnd = cursorEnd

        // Find the text diff in the events
        for (const loroEvent of event.events) {
          const diff = loroEvent.diff as TextDiff
          if (diff.type === "text" && diff.diff) {
            // Use delta-based cursor adjustment for accurate positioning
            const adjusted = adjustSelectionFromDelta(
              cursorStart,
              cursorEnd,
              diff.diff as Delta<string>[],
            )
            newCursorStart = adjusted.start
            newCursorEnd = adjusted.end
            break // Only process the first text diff
          }
        }

        // Clamp to valid range
        newCursorStart = Math.max(0, Math.min(newCursorStart, newValue.length))
        newCursorEnd = Math.max(0, Math.min(newCursorEnd, newValue.length))

        input.setSelectionRange(newCursorStart, newCursorEnd)

        onAfterChange?.()
      })

      return unsubscribe
    }, [textRef, loroRef, onAfterChange])

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (cleanupRef.current) {
          cleanupRef.current()
          cleanupRef.current = null
        }
      }
    }, [])

    return {
      inputRef: setInputRef,
      // Use raw CRDT value - placeholder should be shown via HTML placeholder attribute
      defaultValue: getRawTextValue(textRef),
      // Expose the Shape placeholder for use as HTML placeholder attribute
      placeholder: getPlaceholder<string>(textRef),
    }
  }

  return { useCollaborativeText }
}
