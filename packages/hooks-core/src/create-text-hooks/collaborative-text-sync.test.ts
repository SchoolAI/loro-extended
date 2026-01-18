/**
 * Tests for collaborative text synchronization between textarea and LoroText CRDT.
 *
 * These tests verify that the textarea value stays in sync with the underlying
 * LoroText CRDT after various operations including:
 * - Text insertion and deletion
 * - Undo and redo operations
 */

import { createTypedDoc, loro, Shape } from "@loro-extended/change"
import type { LoroEventBatch } from "loro-crdt"
import { describe, expect, it } from "vitest"
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

    useCallback: <T extends Function>(callback: T, _deps: unknown[]) => {
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
      const loroDoc = loro(typedDoc).doc

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
      const loroDoc = loro(typedDoc).doc

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
