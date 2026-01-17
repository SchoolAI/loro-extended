import type { LoroTextRef, TextRef } from "@loro-extended/change"
import { loro } from "@loro-extended/change"
import type { FrameworkHooks } from "../types"
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
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing useCollaborativeText hook
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

          // Update local tracking
          lastKnownValueRef.current = textRef.toString()

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
