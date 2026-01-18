import { createTypedDoc, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { CursorRegistry } from "./cursor-registry"

// Create a test schema with multiple text fields
const testSchema = Shape.doc({
  title: Shape.text(),
  description: Shape.text(),
  notes: Shape.text(),
})

// Mock HTML input element
function createMockInput(id: string): HTMLInputElement {
  const input = document.createElement("input")
  input.id = id
  return input
}

// Mock HTML textarea element
function createMockTextarea(id: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea")
  textarea.id = id
  return textarea
}

describe("CursorRegistry", () => {
  it("registers and unregisters elements by container ID", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const input = createMockInput("title-input")

    // Register
    registry.register(titleRef, input)

    // Should be able to retrieve by container ID
    const containerIds = registry.getAllContainerIds()
    expect(containerIds.length).toBe(1)

    const registered = registry.getElement(containerIds[0])
    expect(registered).not.toBeNull()
    expect(registered?.element).toBe(input)
    expect(registered?.textRef).toBe(titleRef)

    // Unregister
    registry.unregister(titleRef)

    // Should no longer be retrievable
    expect(registry.getAllContainerIds().length).toBe(0)
    expect(registry.getElement(containerIds[0])).toBeNull()
  })

  it("tracks focused element and its container ID", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const descRef = doc.description
    const titleInput = createMockInput("title-input")
    const descInput = createMockTextarea("desc-input")

    // Register both
    registry.register(titleRef, titleInput)
    registry.register(descRef, descInput)

    // Initially no focus
    expect(registry.getFocused()).toBeNull()

    // Focus title
    registry.setFocused(titleRef)
    const focused = registry.getFocused()
    expect(focused).not.toBeNull()
    expect(focused?.element).toBe(titleInput)
    expect(focused?.textRef).toBe(titleRef)

    // Focus description
    registry.setFocused(descRef)
    const focused2 = registry.getFocused()
    expect(focused2).not.toBeNull()
    expect(focused2?.element).toBe(descInput)
    expect(focused2?.textRef).toBe(descRef)

    // Clear focus
    registry.setFocused(null)
    expect(registry.getFocused()).toBeNull()
  })

  it("returns null for unregistered container ID", () => {
    const registry = new CursorRegistry()

    // Try to get an element that was never registered
    expect(registry.getElement("non-existent-id")).toBeNull()
  })

  it("handles multiple elements", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const descRef = doc.description
    const notesRef = doc.notes
    const titleInput = createMockInput("title-input")
    const descInput = createMockTextarea("desc-input")
    const notesInput = createMockTextarea("notes-input")

    // Register all three
    registry.register(titleRef, titleInput)
    registry.register(descRef, descInput)
    registry.register(notesRef, notesInput)

    // Should have all three
    expect(registry.getAllContainerIds().length).toBe(3)

    // Each should be retrievable
    const containerIds = registry.getAllContainerIds()
    for (const id of containerIds) {
      expect(registry.getElement(id)).not.toBeNull()
    }

    // Unregister one
    registry.unregister(descRef)
    expect(registry.getAllContainerIds().length).toBe(2)
  })

  it("updates focus state on focus/blur", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const titleInput = createMockInput("title-input")

    registry.register(titleRef, titleInput)

    // Simulate focus
    registry.setFocused(titleRef)
    expect(registry.getFocused()?.element).toBe(titleInput)

    // Simulate blur
    registry.setFocused(null)
    expect(registry.getFocused()).toBeNull()
  })

  it("clears focus when focused element is unregistered", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const titleInput = createMockInput("title-input")

    registry.register(titleRef, titleInput)
    registry.setFocused(titleRef)

    expect(registry.getFocused()).not.toBeNull()

    // Unregister the focused element
    registry.unregister(titleRef)

    // Focus should be cleared
    expect(registry.getFocused()).toBeNull()
  })

  it("stores namespace with registration", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const descRef = doc.description
    const titleInput = createMockInput("title-input")
    const descInput = createMockTextarea("desc-input")

    // Register with namespaces
    registry.register(titleRef, titleInput, "header")
    registry.register(descRef, descInput, "body")

    // Focus title and check namespace
    registry.setFocused(titleRef)
    expect(registry.getFocused()?.namespace).toBe("header")

    // Focus description and check namespace
    registry.setFocused(descRef)
    expect(registry.getFocused()?.namespace).toBe("body")
  })

  it("handles registration without namespace", () => {
    const registry = new CursorRegistry()
    const doc = createTypedDoc(testSchema)
    const titleRef = doc.title
    const titleInput = createMockInput("title-input")

    // Register without namespace
    registry.register(titleRef, titleInput)

    registry.setFocused(titleRef)
    expect(registry.getFocused()?.namespace).toBeUndefined()
  })
})
