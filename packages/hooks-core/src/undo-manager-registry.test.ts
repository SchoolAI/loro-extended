import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import {
  NAMESPACE_ORIGIN_PREFIX,
  UndoManagerRegistry,
} from "./undo-manager-registry"

describe("UndoManagerRegistry", () => {
  it("returns existing manager for same namespace", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    const manager1 = registry.getOrCreate("header")
    const manager2 = registry.getOrCreate("header")

    expect(manager1).toBe(manager2)
  })

  it("creates new manager for new namespace", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    const headerManager = registry.getOrCreate("header")
    const bodyManager = registry.getOrCreate("body")

    expect(headerManager).not.toBe(bodyManager)
  })

  it("creates manager with correct excludeOriginPrefixes for new namespace", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    // Register both namespaces BEFORE making changes
    // This is the recommended pattern - register all namespaces upfront
    registry.getOrCreate("header")
    const bodyManager = registry.getOrCreate("body")

    // Make a change with "header" origin
    loroDoc.setNextCommitOrigin(`${NAMESPACE_ORIGIN_PREFIX}header`)
    loroDoc.getText("test").insert(0, "header text")
    loroDoc.commit()

    // Make a change with "body" origin
    loroDoc.setNextCommitOrigin(`${NAMESPACE_ORIGIN_PREFIX}body`)
    loroDoc.getText("test").insert(0, "body text")
    loroDoc.commit()

    // Body manager should be able to undo the body change
    expect(bodyManager.canUndo()).toBe(true)
    bodyManager.undo()

    // After undo, the text should only have "header text"
    expect(loroDoc.getText("test").toString()).toBe("header text")
  })

  it("getAllNamespaces returns all registered namespaces including undefined", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate(undefined) // default namespace
    registry.getOrCreate("header")
    registry.getOrCreate("body")

    const namespaces = registry.getAllNamespaces()

    expect(namespaces).toContain(undefined)
    expect(namespaces).toContain("header")
    expect(namespaces).toContain("body")
    expect(namespaces.length).toBe(3)
  })

  it("get returns undefined for unregistered namespace", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    expect(registry.get("nonexistent")).toBeUndefined()
  })

  it("get returns manager for registered namespace", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    const created = registry.getOrCreate("header")
    const retrieved = registry.get("header")

    expect(retrieved).toBe(created)
  })

  it("clear removes all managers", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate("header")
    registry.getOrCreate("body")

    expect(registry.getAllNamespaces().length).toBe(2)

    registry.clear()

    expect(registry.getAllNamespaces().length).toBe(0)
    expect(registry.get("header")).toBeUndefined()
    expect(registry.get("body")).toBeUndefined()
  })

  it("passes onPush and onPop callbacks to UndoManager", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    const onPush = vi.fn().mockReturnValue({ value: null, cursors: [] })
    const onPop = vi.fn()

    const manager = registry.getOrCreate("header", {
      onPush,
      onPop,
    })

    // Make a change
    loroDoc.getText("test").insert(0, "hello")
    loroDoc.commit()

    // onPush should have been called
    expect(onPush).toHaveBeenCalled()

    // Undo
    manager.undo()

    // onPop should have been called
    expect(onPop).toHaveBeenCalled()
  })

  it("respects mergeInterval option", () => {
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    // Create manager with 0 merge interval (each change is separate)
    const manager = registry.getOrCreate("header", { mergeInterval: 0 })

    // Make two changes
    loroDoc.getText("test").insert(0, "a")
    loroDoc.commit()
    loroDoc.getText("test").insert(1, "b")
    loroDoc.commit()

    // Should be able to undo twice
    expect(manager.canUndo()).toBe(true)
    manager.undo()
    expect(loroDoc.getText("test").toString()).toBe("a")

    expect(manager.canUndo()).toBe(true)
    manager.undo()
    expect(loroDoc.getText("test").toString()).toBe("")
  })
})

describe("late namespace registration warning", () => {
  it("warns when registering a namespace after other managers exist", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate("header")
    registry.getOrCreate("body") // Should warn

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Registering namespace "body"'),
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("after other managers exist"),
    )
    consoleSpy.mockRestore()
  })

  it("does not warn for first namespace registration", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate("header") // Should not warn

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("does not warn when registering undefined namespace after others", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate("header")
    registry.getOrCreate(undefined) // Should not warn (undefined namespace)

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("does not warn when getting existing namespace", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const loroDoc = new LoroDoc()
    const registry = new UndoManagerRegistry(loroDoc)

    registry.getOrCreate("header")
    registry.getOrCreate("header") // Getting existing, should not warn

    // Only one call (from the first registration? No, first doesn't warn either)
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
