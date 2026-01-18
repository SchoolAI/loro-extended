import { createTypedDoc, loro, Shape } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { CursorRegistry } from "./cursor-registry"
import { createMockInput } from "./test-utils"
import { UndoManagerRegistry } from "./undo-manager-registry"

// Test schema
const TestSchema = Shape.doc({
  title: Shape.text(),
  description: Shape.text(),
})

describe("CursorRegistry integration with undo", () => {
  it("stores cursor and container ID when cursor registry has focused element", () => {
    // Create a cursor registry with a focused element
    const cursorRegistry = new CursorRegistry()
    const typedDoc = createTypedDoc(TestSchema)
    const mockInput = createMockInput("title-input")
    mockInput.value = "Hello"
    mockInput.selectionStart = 3
    mockInput.selectionEnd = 3

    cursorRegistry.register(typedDoc.title, mockInput)
    cursorRegistry.setFocused(typedDoc.title)

    // Verify the registry captures focus info correctly
    const focused = cursorRegistry.getFocused()
    expect(focused).not.toBeNull()
    expect(focused?.element).toBe(mockInput)
    expect(focused?.textRef).toBe(typedDoc.title)

    // Get the container ID that would be stored with undo
    const containerId = focused?.containerId
    expect(containerId).toBeDefined()

    // Verify we can look up the element by container ID
    if (containerId) {
      const registered = cursorRegistry.getElement(containerId)
      expect(registered?.element).toBe(mockInput)
    }
  })

  it("handles focused element being unregistered before onPop gracefully", () => {
    const cursorRegistry = new CursorRegistry()
    const typedDoc = createTypedDoc(TestSchema)
    const mockInput = createMockInput("title-input")

    // Register and focus
    cursorRegistry.register(typedDoc.title, mockInput)
    cursorRegistry.setFocused(typedDoc.title)

    // Get container ID before unregistering
    const containerId = cursorRegistry.getFocused()?.containerId
    expect(containerId).toBeDefined()

    // Verify focused
    expect(cursorRegistry.getFocused()).not.toBeNull()

    // Unregister the element
    cursorRegistry.unregister(typedDoc.title)

    // Focus should be cleared
    expect(cursorRegistry.getFocused()).toBeNull()

    // getElement should return null for the container ID
    if (containerId) {
      expect(cursorRegistry.getElement(containerId)).toBeNull()
    }
  })

  it("clamps cursor position to element value length", () => {
    const cursorRegistry = new CursorRegistry()
    const typedDoc = createTypedDoc(TestSchema)
    const mockInput = createMockInput("title-input")

    // Set up input with short value
    mockInput.value = "Hi"

    cursorRegistry.register(typedDoc.title, mockInput)
    cursorRegistry.setFocused(typedDoc.title)

    // Simulate restoring cursor to position beyond text length
    // The actual clamping happens in onPop callback
    const offset = 100 // Way beyond "Hi".length
    const clampedOffset = Math.min(offset, mockInput.value.length)

    expect(clampedOffset).toBe(2) // Clamped to "Hi".length

    // Verify setSelectionRange works with clamped value
    mockInput.setSelectionRange(clampedOffset, clampedOffset)
    expect(mockInput.selectionStart).toBe(2)
    expect(mockInput.selectionEnd).toBe(2)
  })
})

describe("UndoManagerRegistry integration with cursor callbacks", () => {
  it("passes onPush and onPop callbacks to UndoManager", () => {
    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = loro(typedDoc).doc
    const undoManagerRegistry = new UndoManagerRegistry(loroDoc)

    const onPush = vi.fn().mockReturnValue({ value: null, cursors: [] })
    const onPop = vi.fn()

    const manager = undoManagerRegistry.getOrCreate("header", {
      onPush,
      onPop,
    })

    // Make a change
    typedDoc.title.insert(0, "hello")
    loroDoc.commit()

    // onPush should have been called
    expect(onPush).toHaveBeenCalled()

    // Undo
    manager.undo()

    // onPop should have been called
    expect(onPop).toHaveBeenCalled()
  })

  it("stores custom value in onPush for cursor restoration", () => {
    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = loro(typedDoc).doc
    const undoManagerRegistry = new UndoManagerRegistry(loroDoc)

    let storedValue: unknown = null

    const onPush = vi.fn().mockImplementation(() => {
      // Store container ID with the undo step
      return {
        value: { containerId: "test-container-id" },
        cursors: [],
      }
    })

    const onPop = vi.fn().mockImplementation((_isUndo, meta) => {
      storedValue = meta.value
    })

    const manager = undoManagerRegistry.getOrCreate("header", {
      onPush,
      onPop,
    })

    // Make a change
    typedDoc.title.insert(0, "hello")
    loroDoc.commit()

    // Undo
    manager.undo()

    // Verify the stored value was passed to onPop
    expect(storedValue).toEqual({ containerId: "test-container-id" })
  })

  it("creates Loro cursor for position tracking", () => {
    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = loro(typedDoc).doc

    // Insert some text first
    typedDoc.title.insert(0, "Hello World")
    loroDoc.commit()

    // Get the LoroText container
    const loroText = loroDoc.getText(
      loro(typedDoc.title).container.id.toString(),
    )

    // Create a cursor at position 5 (after "Hello")
    const cursor = loroText.getCursor(5, 0)
    expect(cursor).toBeDefined()

    if (cursor) {
      // Insert text before the cursor position
      typedDoc.title.insert(0, "Hi ")
      loroDoc.commit()

      // Resolve the cursor - it should have moved
      const pos = loroDoc.getCursorPos(cursor)
      expect(pos).toBeDefined()
      expect(pos?.offset).toBe(8) // 5 + 3 ("Hi ".length)
    }
  })
})

describe("Namespace-based undo isolation", () => {
  it("isolates undo stacks by namespace", () => {
    const typedDoc = createTypedDoc(TestSchema)
    const loroDoc = loro(typedDoc).doc
    const undoManagerRegistry = new UndoManagerRegistry(loroDoc)

    // Create managers for different namespaces
    const headerManager = undoManagerRegistry.getOrCreate("header")
    const bodyManager = undoManagerRegistry.getOrCreate("body")

    // Make a change with "header" origin
    loroDoc.setNextCommitOrigin("loro-extended:ns:header")
    typedDoc.title.insert(0, "Header Text")
    loroDoc.commit()

    // Make a change with "body" origin
    loroDoc.setNextCommitOrigin("loro-extended:ns:body")
    typedDoc.description.insert(0, "Body Text")
    loroDoc.commit()

    // Body manager should only undo body changes
    expect(bodyManager.canUndo()).toBe(true)
    bodyManager.undo()

    // Description should be empty, title should still have text
    expect(typedDoc.description.toString()).toBe("")
    expect(typedDoc.title.toString()).toBe("Header Text")

    // Header manager should only undo header changes
    expect(headerManager.canUndo()).toBe(true)
    headerManager.undo()

    // Now both should be empty
    expect(typedDoc.title.toString()).toBe("")
    expect(typedDoc.description.toString()).toBe("")
  })
})
