/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DocHandle, type DocHandleServices } from "./doc-handle.js"

// Helper to wait for one or more events
const waitForEvents = (
  handle: DocHandle<any>,
  eventName: string,
  count: number,
) => {
  return new Promise<void>(resolve => {
    let events = 0
    const listener = () => {
      events++
      if (events === count) {
        handle.off(eventName as any, listener)
        resolve()
      }
    }
    handle.on(eventName as any, listener)
  })
}

const waitForEvent = (handle: DocHandle<any>, eventName: string) =>
  waitForEvents(handle, eventName, 1)

describe("DocHandle Integration Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("should initialize with an always-available document", () => {
    const handle = new DocHandle("test-doc")
    expect(handle.doc).toBeInstanceOf(LoroDoc)
    expect(handle.documentId).toBe("test-doc")
  })

  it("should load from storage in the background", async () => {
    const mockDoc = new LoroDoc()
    mockDoc.getMap("doc").set("text", "from storage")
    
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockImplementation(async (documentId, doc) => {
        // Import the mock data into the provided doc
        const exported = mockDoc.export({ mode: "snapshot" })
        doc.import(exported)
      }),
    }
    const handle = new DocHandle("test-doc", services)

    // Wait for storage to load
    await handle.waitForStorage(1000)
    
    expect(services.loadFromStorage).toHaveBeenCalledWith("test-doc", handle.doc)
    expect(handle.doc.getMap("doc").get("text")).toBe("from storage")
  })

  it("should handle storage load failure gracefully", async () => {
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockRejectedValue(new Error("Storage error")),
    }
    // Disable auto-loading to prevent background operations
    const handle = new DocHandle("test-doc", services, { autoLoad: false })

    // Start the wait and advance timers to trigger timeout
    const waitPromise = handle.waitForStorage(100)
    await vi.advanceTimersByTimeAsync(100)
    
    // Should timeout when storage fails
    await expect(waitPromise).rejects.toThrow("Readiness timeout")
    
    // But document should still be available for use
    expect(handle.doc).toBeInstanceOf(LoroDoc)
  })

  it("should allow changing the document immediately", async () => {
    type TestSchema = { doc: LoroMap<{ text: string }> }
    const handle = new DocHandle<TestSchema>("test-doc")

    const changePromise = waitForEvent(handle, "doc-change")

    handle.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", "hello world")
    })

    await changePromise
    const jsDoc = handle.doc.getMap("doc").toJSON()
    expect(jsDoc.text).toBe("hello world")
  })

  it("should emit local change events for network sync", async () => {
    const handle = new DocHandle("test-doc")

    const syncPromise = waitForEvent(handle, "doc-local-change")
    const listener = vi.fn()
    handle.on("doc-local-change", listener)

    handle.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", "hello")
    })

    await syncPromise
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
  })

  it("should sync changes between two handles", async () => {
    // Setup handle A
    const handleA = new DocHandle<any>("sync-doc")

    // Setup handle B
    const handleB = new DocHandle<any>("sync-doc")

    // Pipe messages from A to B
    handleA.on("doc-local-change", (message: Uint8Array) => {
      handleB.applySyncMessage(message)
    })

    const changePromise = waitForEvent(handleB, "doc-change")
    handleA.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", "synced")
    })

    await changePromise

    const jsDocB = handleB.doc.getMap("doc").toJSON()
    expect(jsDocB.text).toBe("synced")
  })

  it("should support flexible readiness API", async () => {
    const services: DocHandleServices<any> = {
      loadFromStorage: vi.fn().mockImplementation(async (documentId, doc) => {
        // Simulate loading delay
        await new Promise(resolve => setTimeout(resolve, 50))
        doc.getMap("doc").set("loaded", true)
      }),
      requestFromNetwork: vi.fn().mockImplementation(async (documentId, doc) => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100))
        doc.getMap("doc").set("networked", true)
      }),
    }
    const handle = new DocHandle("test-doc", services)

    // Start the readiness check and advance timers
    const readyPromise = handle.waitUntilReady(
      (readyStates) =>
        readyStates.some(
          (s) => s.source.type === "storage" && s.state.type === "found"
        ),
      200
    )
    
    // Advance timers to complete the storage loading
    await vi.advanceTimersByTimeAsync(50)
    await readyPromise

    expect(handle.doc.getMap("doc").get("loaded")).toBe(true)
  })

  it("should track peer status", () => {
    const handle = new DocHandle("test-doc")

    // Update peer status
    handle.updatePeerStatus("peer1", { hasDoc: true, isAwareOfDoc: true, isSyncingNow: false })
    handle.updatePeerStatus("peer2", { hasDoc: false, isAwareOfDoc: true, isSyncingNow: true })

    // Check peer status
    expect(handle.getPeerStatus("peer1")).toEqual({
      hasDoc: true,
      isAwareOfDoc: true,
      isSyncingNow: false,
    })

    // Get peers with doc
    expect(handle.getPeersWithDoc()).toEqual(["peer1"])
    expect(handle.getPeersAwareOfDoc()).toEqual(["peer1", "peer2"])

    // Remove peer
    handle.removePeer("peer1")
    expect(handle.getPeerStatus("peer1")).toBeUndefined()
    expect(handle.getPeersWithDoc()).toEqual([])
  })

  it("should handle save to storage", async () => {
    const saveToStorage = vi.fn()
    const services: DocHandleServices<any> = {
      saveToStorage,
    }
    const handle = new DocHandle("test-doc", services)

    handle.change(doc => {
      doc.getMap("doc").set("text", "save me")
    })

    // Wait a bit for the save to be called
    await vi.advanceTimersByTimeAsync(10)

    expect(saveToStorage).toHaveBeenCalledWith(
      "test-doc",
      handle.doc,
      expect.any(Object) // LoroEventBatch
    )
  })
})
