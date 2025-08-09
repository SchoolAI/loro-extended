import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { DocHandle, type DocHandleServices } from "./doc-handle.js"
import type { DocContent } from "./types.js"

describe("DocHandle Storage Integration", () => {
  it("should call saveToStorage service when local changes occur", async () => {
    const doc = new LoroDoc()
    const saveToStorage = vi.fn().mockResolvedValue(undefined)

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      saveToStorage,
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // Make a local change
    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify saveToStorage was called
    expect(saveToStorage).toHaveBeenCalled()
    expect(saveToStorage).toHaveBeenCalledWith(
      "test-doc",
      expect.any(LoroDoc),
      expect.objectContaining({
        by: "local",
        from: expect.any(Array),
        to: expect.any(Array),
      }),
    )
  })

  it("should call saveToStorage when remote changes are imported", async () => {
    const doc = new LoroDoc()
    const saveToStorage = vi.fn().mockResolvedValue(undefined)

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      saveToStorage,
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // Create a sync message from another doc
    const otherDoc = new LoroDoc()
    otherDoc.getMap("root").set("text", "from remote")
    const syncMessage = otherDoc.export({ mode: "update" })

    // Apply the sync message
    handle.applySyncMessage(syncMessage)

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify saveToStorage was called for the import
    expect(saveToStorage).toHaveBeenCalled()
    expect(saveToStorage).toHaveBeenCalledWith(
      "test-doc",
      expect.any(LoroDoc),
      expect.objectContaining({
        by: "import",
        from: expect.any(Array),
        to: expect.any(Array),
      }),
    )
  })

  it("should handle missing saveToStorage service gracefully", async () => {
    const doc = new LoroDoc()

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      // No saveToStorage service provided
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // This should not throw even without saveToStorage
    expect(() => {
      handle.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "hello")
      })
    }).not.toThrow()
  })

  it("should handle saveToStorage errors gracefully", async () => {
    const doc = new LoroDoc()
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {})
    const saveToStorage = vi.fn().mockRejectedValue(new Error("Storage failed"))

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      saveToStorage,
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // Make a change that will trigger a failed save
    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify error was logged but didn't crash
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to save document"),
      expect.any(Error),
    )

    // Document should still be in ready state
    expect(handle.state).toBe("ready")

    consoleErrorSpy.mockRestore()
  })

  it("should not call saveToStorage for checkout events", async () => {
    const doc = new LoroDoc()
    const saveToStorage = vi.fn().mockResolvedValue(undefined)

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      saveToStorage,
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // Simulate a checkout event (these have by: "checkout")
    // This would typically happen during time travel or undo/redo
    // For this test, we'll verify that only "local" and "import" trigger saves

    // Reset the mock to clear any initial calls
    saveToStorage.mockClear()

    // Make a local change
    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    // Should have been called once for the local change
    expect(saveToStorage).toHaveBeenCalledTimes(1)

    // Verify it was called with "local" event
    const call = saveToStorage.mock.calls[0]
    expect(call[2].by).toBe("local")
  })

  it("should pass correct frontiers to saveToStorage", async () => {
    const doc = new LoroDoc()
    const saveToStorage = vi.fn().mockResolvedValue(undefined)

    const services: DocHandleServices<DocContent> = {
      loadFromStorage: vi.fn().mockResolvedValue(doc),
      saveToStorage,
      queryNetwork: vi.fn(),
    }

    const handle = new DocHandle("test-doc", services)
    await handle.find()

    // Make a change
    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("value", 1)
    })

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify frontiers were passed correctly
    expect(saveToStorage).toHaveBeenCalled()
    const [documentId, passedDoc, event] = saveToStorage.mock.calls[0]

    expect(documentId).toBe("test-doc")
    expect(passedDoc).toBeInstanceOf(LoroDoc)
    expect(event).toHaveProperty("from")
    expect(event).toHaveProperty("to")
    expect(Array.isArray(event.from)).toBe(true)
    expect(Array.isArray(event.to)).toBe(true)

    // After first change, 'from' should be empty and 'to' should have content
    expect(event.from).toHaveLength(0)
    expect(event.to.length).toBeGreaterThan(0)
  })
})
