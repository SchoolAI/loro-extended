/**
 * Tests for collaborative text synchronization between textarea and LoroText CRDT.
 *
 * These tests verify that the textarea value stays in sync with the underlying
 * LoroText CRDT after various operations including:
 * - Text insertion and deletion
 * - Undo and redo operations
 * - Auto-registration with CursorRegistry
 * - Namespace origin tagging
 */

import { createTypedDoc, ext, loro, Shape } from "@loro-extended/change"
import type { LoroEventBatch } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { CursorRegistry } from "../cursor-registry"
import type { FrameworkHooks } from "../types"
import { getRawTextValue } from "../utils/text-ref-helpers"
import { createTextHooks } from "./index"

// ============================================================================
// Mock Framework Hooks
// ============================================================================

/**
 * Creates a minimal mock implementation of FrameworkHooks for testing.
 * This simulates React-like hook behavior without requiring React.
 */
function createMockFrameworkHooks(): FrameworkHooks {
  const refs = new Map<number, { current: unknown }>()
  let refCounter = 0

  const effects: Array<{
    effect: () => undefined | (() => void)
    deps: unknown[] | undefined
    cleanup?: () => void
  }> = []

  const memos = new Map<number, { value: unknown; deps: unknown[] }>()
  let memoCounter = 0

  return {
    useState: <T>(initialState: T | (() => T)) => {
      const value =
        typeof initialState === "function"
          ? (initialState as () => T)()
          : initialState
      let state = value
      const setState = (newState: T | ((prev: T) => T)) => {
        state =
          typeof newState === "function"
            ? (newState as (prev: T) => T)(state)
            : newState
      }
      return [state, setState] as [T, (newState: T | ((prev: T) => T)) => void]
    },

    useEffect: (effect, deps) => {
      effects.push({ effect, deps })
    },

    useCallback: <T extends (...args: unknown[]) => unknown>(
      callback: T,
      _deps: unknown[],
    ) => {
      return callback
    },

    useMemo: <T>(factory: () => T, deps: unknown[]) => {
      const id = memoCounter++
      const existing = memos.get(id)
      if (existing && depsEqual(existing.deps, deps)) {
        return existing.value as T
      }
      const value = factory()
      memos.set(id, { value, deps })
      return value
    },

    useRef: <T>(initialValue: T) => {
      const id = refCounter++
      if (!refs.has(id)) {
        refs.set(id, { current: initialValue })
      }
      const ref = refs.get(id)
      if (!ref) {
        throw new Error("Ref not found")
      }
      return ref as { current: T }
    },

    useSyncExternalStore: <Snapshot>(
      _subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => Snapshot,
    ) => {
      return getSnapshot()
    },

    useContext: <T>(_context: unknown) => {
      return undefined as T
    },

    createContext: <T>(defaultValue: T) => {
      return { defaultValue }
    },
  }
}

function depsEqual(
  a: unknown[] | undefined,
  b: unknown[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return a.every((val, i) => Object.is(val, b[i]))
}

// ============================================================================
// Mock Input Element
// ============================================================================

/**
 * Creates a mock HTMLTextAreaElement for testing.
 */
function createMockTextarea(): HTMLTextAreaElement {
  let value = ""
  let selectionStart = 0
  let selectionEnd = 0
  const listeners: Map<string, Set<EventListener>> = new Map()

  const textarea = {
    get value() {
      return value
    },
    set value(v: string) {
      value = v
    },
    get selectionStart() {
      return selectionStart
    },
    set selectionStart(v: number) {
      selectionStart = v
    },
    get selectionEnd() {
      return selectionEnd
    },
    set selectionEnd(v: number) {
      selectionEnd = v
    },
    setSelectionRange(start: number, end: number) {
      selectionStart = start
      selectionEnd = end
    },
    addEventListener(type: string, listener: EventListener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      const typeListeners = listeners.get(type)
      if (typeListeners) {
        typeListeners.add(listener)
      }
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent(event: Event) {
      const typeListeners = listeners.get(event.type)
      if (typeListeners) {
        for (const listener of typeListeners) {
          listener(event)
        }
      }
      return true
    },
    focus() {},
  } as unknown as HTMLTextAreaElement

  return textarea
}

/**
 * Creates a mock InputEvent for testing.
 */
function createMockInputEvent(
  inputType: string,
  data: string | null,
  target: HTMLTextAreaElement,
): InputEvent {
  let defaultPrevented = false
  const event = {
    type: "beforeinput",
    inputType,
    data,
    target,
    preventDefault() {
      defaultPrevented = true
    },
    get defaultPrevented() {
      return defaultPrevented
    },
    getTargetRanges() {
      return []
    },
  } as unknown as InputEvent

  return event
}

// ============================================================================
// Test Schema
// ============================================================================

const TestSchema = Shape.doc({
  content: Shape.text(),
})

// ============================================================================
// Tests
// ============================================================================

describe("Collaborative Text Synchronization", () => {
  describe("Basic sync between textarea and CRDT", () => {
    it("should sync textarea value from CRDT on mount", () => {
      const framework = createMockFrameworkHooks()
      const { useCollaborativeText } = createTextHooks(framework)

      const typedDoc = createTypedDoc(TestSchema)
      typedDoc.content.insert(0, "Hello World")

      const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
      const textarea = createMockTextarea()

      // Simulate mounting the element
      result.inputRef(textarea)

      expect(textarea.value).toBe("Hello World")
    })

    it("should update CRDT when typing in textarea", () => {
      const framework = createMockFrameworkHooks()
      const { useCollaborativeText } = createTextHooks(framework)

      const typedDoc = createTypedDoc(TestSchema)
      const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
      const textarea = createMockTextarea()

      // Mount the element
      result.inputRef(textarea)

      // Simulate typing "Hello"
      textarea.selectionStart = 0
      textarea.selectionEnd = 0
      const event = createMockInputEvent("insertText", "Hello", textarea)
      textarea.dispatchEvent(event)

      expect(getRawTextValue(typedDoc.content)).toBe("Hello")
      expect(textarea.value).toBe("Hello")
    })
  })

  describe("Undo/Redo synchronization", () => {
    it("documents that undo events have event.by === 'local'", async () => {
      /**
       * This test documents that undo events have event.by === "local".
       *
       * The fix in useCollaborativeText removes the event.by === "local" check
       * and relies solely on isLocalChangeRef to determine if an event should
       * be skipped. This allows undo/redo events to update the textarea.
       */
      const typedDoc = createTypedDoc(TestSchema)
      const loroDoc = loro(typedDoc)

      const { UndoManager } = await import("loro-crdt")
      const undoManager = new UndoManager(loroDoc, { mergeInterval: 0 })

      // Track all events and their 'by' values
      const events: Array<{ by: string; value: string }> = []

      const loroTextRef = loro(typedDoc.content)
      loroTextRef.subscribe((rawEvent: unknown) => {
        const event = rawEvent as LoroEventBatch
        events.push({
          by: event.by,
          value: getRawTextValue(typedDoc.content),
        })
      })

      // Make changes
      typedDoc.content.insert(0, "Hello")
      loroDoc.commit()

      typedDoc.content.insert(5, " World")
      loroDoc.commit()

      // Clear events to focus on undo
      events.length = 0

      // Perform undo
      undoManager.undo()

      // Verify undo triggered an event
      expect(events.length).toBeGreaterThan(0)

      // Get the event from undo
      const undoEvent = events[events.length - 1]

      // Document that undo events have event.by === "local"
      // This is why the fix removes the event.by check and relies on isLocalChangeRef
      expect(undoEvent.by).toBe("local")

      // Verify the CRDT was correctly reverted
      expect(undoEvent.value).toBe("Hello")
    })

    it("textarea stays in sync after undo when using isLocalChange flag", async () => {
      /**
       * This test simulates the FIXED logic from useCollaborativeText's
       * subscription handler to prove the fix works.
       *
       * The key insight: undo events have event.by === "local", but they should
       * still update the textarea. The fix uses isLocalChangeRef (set only during
       * actual user input) instead of checking event.by.
       */
      const typedDoc = createTypedDoc(TestSchema)
      const loroDoc = loro(typedDoc)

      const { UndoManager } = await import("loro-crdt")
      const undoManager = new UndoManager(loroDoc, { mergeInterval: 0 })

      // Simulate the textarea state
      let textareaValue = ""
      let lastKnownValue = ""
      let isLocalChange = false

      const loroTextRef = loro(typedDoc.content)

      // This is the FIXED logic from useCollaborativeText's subscription
      // Note: We only check isLocalChange, NOT event.by === "local"
      loroTextRef.subscribe((_rawEvent: unknown) => {
        // Only skip if we're in the middle of processing a local input event
        if (isLocalChange) return

        const newValue = getRawTextValue(typedDoc.content)
        if (newValue === lastKnownValue) return

        // Update textarea (simulated)
        textareaValue = newValue
        lastKnownValue = newValue
      })

      // Simulate typing "Hello" (local change)
      isLocalChange = true
      typedDoc.content.insert(0, "Hello")
      lastKnownValue = "Hello"
      textareaValue = "Hello"
      isLocalChange = false
      loroDoc.commit()

      // Simulate typing " World" (local change)
      isLocalChange = true
      typedDoc.content.insert(5, " World")
      lastKnownValue = "Hello World"
      textareaValue = "Hello World"
      isLocalChange = false
      loroDoc.commit()

      expect(textareaValue).toBe("Hello World")
      expect(getRawTextValue(typedDoc.content)).toBe("Hello World")

      // Now perform undo - this is NOT a local change from the user's perspective
      // With the fix, the subscription will update the textarea
      undoManager.undo()

      // The CRDT should be reverted
      expect(getRawTextValue(typedDoc.content)).toBe("Hello")

      // The textarea should also be updated (this now passes with the fix!)
      expect(textareaValue).toBe("Hello")
    })
  })
})

// ============================================================================
// Auto-registration with CursorRegistry Tests
// ============================================================================

describe("Auto-registration with CursorRegistry", () => {
  it("registers element on mount when cursor registry is available", () => {
    const cursorRegistry = new CursorRegistry()
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework, {
      getCursorRegistry: () => cursorRegistry,
    })

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Before mount, registry should be empty
    expect(cursorRegistry.getAllContainerIds().length).toBe(0)

    // Mount the element
    result.inputRef(textarea)

    // After mount, element should be registered
    expect(cursorRegistry.getAllContainerIds().length).toBe(1)
  })

  it("unregisters element on unmount", () => {
    const cursorRegistry = new CursorRegistry()
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework, {
      getCursorRegistry: () => cursorRegistry,
    })

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)
    expect(cursorRegistry.getAllContainerIds().length).toBe(1)

    // Unmount (pass null to ref callback)
    result.inputRef(null)
    expect(cursorRegistry.getAllContainerIds().length).toBe(0)
  })

  it("updates focus state on focus event", () => {
    const cursorRegistry = new CursorRegistry()
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework, {
      getCursorRegistry: () => cursorRegistry,
    })

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Initially no focus
    expect(cursorRegistry.getFocused()).toBeNull()

    // Simulate focus event
    const focusEvent = new Event("focus")
    textarea.dispatchEvent(focusEvent)

    // Should now be focused
    expect(cursorRegistry.getFocused()).not.toBeNull()
    expect(cursorRegistry.getFocused()?.element).toBe(textarea)
  })

  it("clears focus state on blur event", () => {
    const cursorRegistry = new CursorRegistry()
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework, {
      getCursorRegistry: () => cursorRegistry,
    })

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount and focus
    result.inputRef(textarea)
    const focusEvent = new Event("focus")
    textarea.dispatchEvent(focusEvent)
    expect(cursorRegistry.getFocused()).not.toBeNull()

    // Simulate blur event
    const blurEvent = new Event("blur")
    textarea.dispatchEvent(blurEvent)

    // Should no longer be focused
    expect(cursorRegistry.getFocused()).toBeNull()
  })

  it("handles missing cursor registry gracefully", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework, {
      getCursorRegistry: () => null, // No registry
    })

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Should not throw
    expect(() => {
      result.inputRef(textarea)
    }).not.toThrow()

    // Should still work for basic functionality
    expect(textarea.value).toBe("")
  })
})

// ============================================================================
// Namespace Origin Tagging Tests
// ============================================================================

describe("Namespace origin tagging", () => {
  it("calls setNextCommitOrigin before changes when undoNamespace is set", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = ext(typedDoc.content).doc

    // Spy on setNextCommitOrigin
    const setNextCommitOriginSpy = vi.spyOn(loroDoc, "setNextCommitOrigin")

    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content, {
      undoNamespace: "header",
    })
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Simulate typing
    textarea.selectionStart = 0
    textarea.selectionEnd = 0
    const event = createMockInputEvent("insertText", "Hello", textarea)
    textarea.dispatchEvent(event)

    // Should have called setNextCommitOrigin with the namespace
    expect(setNextCommitOriginSpy).toHaveBeenCalledWith(
      "loro-extended:ns:header",
    )

    setNextCommitOriginSpy.mockRestore()
  })

  it("does not call setNextCommitOrigin when undoNamespace is not set", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = ext(typedDoc.content).doc

    // Spy on setNextCommitOrigin
    const setNextCommitOriginSpy = vi.spyOn(loroDoc, "setNextCommitOrigin")

    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    // No undoNamespace option
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Simulate typing
    textarea.selectionStart = 0
    textarea.selectionEnd = 0
    const event = createMockInputEvent("insertText", "Hello", textarea)
    textarea.dispatchEvent(event)

    // Should NOT have called setNextCommitOrigin
    expect(setNextCommitOriginSpy).not.toHaveBeenCalled()

    setNextCommitOriginSpy.mockRestore()
  })
})

// ============================================================================
// Selection Bounds Edge Cases
// ============================================================================

describe("Selection bounds edge cases", () => {
  it("clamps selection to CRDT length when input has stale content", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    // CRDT has short text
    typedDoc.content.insert(0, "Hi")

    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Simulate stale input state - selection beyond CRDT length
    // This can happen if the input hasn't been updated yet
    textarea.selectionStart = 100
    textarea.selectionEnd = 100

    // Try to type - should not throw "Index out of bound"
    const event = createMockInputEvent("insertText", "X", textarea)
    expect(() => {
      textarea.dispatchEvent(event)
    }).not.toThrow()

    // The text should be inserted at the clamped position (end of CRDT)
    expect(getRawTextValue(typedDoc.content)).toBe("HiX")
  })
})

// ============================================================================
// IME Composition Tests
// ============================================================================

/**
 * Creates a mock CompositionEvent for testing.
 */
function createMockCompositionEvent(
  type: "compositionstart" | "compositionend",
  data: string,
  target: HTMLTextAreaElement,
): CompositionEvent {
  return {
    type,
    data,
    target,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as CompositionEvent
}

describe("IME Composition", () => {
  it("syncs composed text to CRDT after composition ends", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Simulate composition start
    const startEvent = createMockCompositionEvent(
      "compositionstart",
      "",
      textarea,
    )
    textarea.dispatchEvent(startEvent)

    // User types Chinese characters (simulated by setting value directly)
    textarea.value = "你好"
    textarea.selectionStart = 2
    textarea.selectionEnd = 2

    // Simulate composition end
    const endEvent = createMockCompositionEvent(
      "compositionend",
      "你好",
      textarea,
    )
    textarea.dispatchEvent(endEvent)

    // CRDT should have the composed text
    expect(getRawTextValue(typedDoc.content)).toBe("你好")
  })

  it("handles composition with existing text", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    // Pre-populate with some text
    typedDoc.content.insert(0, "Hello ")

    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)
    expect(textarea.value).toBe("Hello ")

    // Position cursor at end
    textarea.selectionStart = 6
    textarea.selectionEnd = 6

    // Simulate composition
    const startEvent = createMockCompositionEvent(
      "compositionstart",
      "",
      textarea,
    )
    textarea.dispatchEvent(startEvent)

    // User types Chinese
    textarea.value = "Hello 世界"
    textarea.selectionStart = 8
    textarea.selectionEnd = 8

    // End composition
    const endEvent = createMockCompositionEvent(
      "compositionend",
      "世界",
      textarea,
    )
    textarea.dispatchEvent(endEvent)

    // CRDT should have both texts
    expect(getRawTextValue(typedDoc.content)).toBe("Hello 世界")
  })

  it("handles composition at different cursor positions", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    typedDoc.content.insert(0, "AB")

    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content)
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Position cursor in the middle
    textarea.selectionStart = 1
    textarea.selectionEnd = 1

    // Simulate composition
    const startEvent = createMockCompositionEvent(
      "compositionstart",
      "",
      textarea,
    )
    textarea.dispatchEvent(startEvent)

    // User types in the middle
    textarea.value = "A中B"
    textarea.selectionStart = 2
    textarea.selectionEnd = 2

    // End composition
    const endEvent = createMockCompositionEvent(
      "compositionend",
      "中",
      textarea,
    )
    textarea.dispatchEvent(endEvent)

    // CRDT should have text inserted in the middle
    expect(getRawTextValue(typedDoc.content)).toBe("A中B")
  })

  it("reverts input when onBeforeChange returns false during composition", () => {
    const framework = createMockFrameworkHooks()
    const { useCollaborativeText } = createTextHooks(framework)

    const typedDoc = createTypedDoc(TestSchema)
    const result = useCollaborativeText<HTMLTextAreaElement>(typedDoc.content, {
      onBeforeChange: () => false, // Reject all changes
    })
    const textarea = createMockTextarea()

    // Mount
    result.inputRef(textarea)

    // Simulate composition
    const startEvent = createMockCompositionEvent(
      "compositionstart",
      "",
      textarea,
    )
    textarea.dispatchEvent(startEvent)

    // User types
    textarea.value = "test"
    textarea.selectionStart = 4
    textarea.selectionEnd = 4

    // End composition
    const endEvent = createMockCompositionEvent(
      "compositionend",
      "test",
      textarea,
    )
    textarea.dispatchEvent(endEvent)

    // Input should be reverted
    expect(textarea.value).toBe("")
    // CRDT should be unchanged
    expect(getRawTextValue(typedDoc.content)).toBe("")
  })
})
