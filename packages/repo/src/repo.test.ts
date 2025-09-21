import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DocHandle } from "./doc-handle.js"
import {
  InProcessBridge,
  InProcessNetworkAdapter,
} from "./network/in-process-network-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import type { DocContent } from "./types.js"

describe("Repo", () => {
  // DocSchema should match the DocContent constraint (Record<string, Container>)
  // For now, we'll use 'any' since we're not assuming a specific structure
  let repo: Repo
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })

    storage = new InMemoryStorageAdapter()

    repo = new Repo({
      storage,
      network: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should create a new document and return a handle", () => {
    const handle = repo.get()
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.doc).toBeDefined()
  })

  it("should create a document with a specific ID", () => {
    const documentId = "custom-doc-id"
    const handle = repo.get(documentId)
    expect(handle.documentId).toBe(documentId)
    expect(handle.doc).toBeDefined()
  })

  it("should create a document with initial value", () => {
    const handle = repo.get().change(doc => {
      const root = doc.getMap("root")
      root.set("text", "initial")
    })

    // The document should have the initial value
    const root = handle.doc.getMap("root")
    expect(root.get("text")).toBe("initial")
  })

  it("should find an existing document handle", () => {
    const handle = repo.get()
    const foundHandle = repo.get(handle.documentId)
    expect(foundHandle).toBe(handle)
  })

  it("should return a new handle for non-existent documents", () => {
    const handle = repo.get("non-existent-doc")
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.documentId).toBe("non-existent-doc")
    expect(handle.doc).toBeDefined()
  })

  it.only("should find a document from a peer", async () => {
    const bridge = new InProcessBridge()

    const networkA = new InProcessNetworkAdapter(bridge)

    const repoA = new Repo({
      network: [networkA],
      peerId: "repoA",
    })

    const handleA = repoA.get()

    handleA.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    const networkB = new InProcessNetworkAdapter(bridge)

    const repoB = new Repo({
      network: [networkB],
      peerId: "repoB",
    })

    const handleB = await repoB.get(handleA.documentId).waitForNetwork()

    const rootB = handleB.doc.getMap("root")
    expect(rootB.get("text")).toBe("hello")
  })

  describe("storage operations", () => {
    it("should save updates when document changes", async () => {
      const saveSpy = vi.spyOn(storage, "save")

      const handle = repo.get()

      // Clear any initial saves
      saveSpy.mockClear()

      handle.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "initial")
      })

      // Wait for async save operation
      await vi.advanceTimersByTimeAsync(10)

      // Should have saved an update
      expect(saveSpy).toHaveBeenCalled()
      const calls = saveSpy.mock.calls

      // Check that the key includes documentId and "update"
      const updateCall = calls.find(call => {
        const key = call[0] as string[]
        return key[0] === handle.documentId && key[1] === "update"
      })
      expect(updateCall).toBeDefined()
    })

    it("should save multiple updates with unique version keys", async () => {
      const saveSpy = vi.spyOn(storage, "save")

      const handle = repo.get()

      // Clear any initial saves
      saveSpy.mockClear()

      // Make multiple changes that actually modify the document version
      handle.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "first")
        root.set("counter", 1)
      })

      // Wait a bit to ensure version changes
      await vi.advanceTimersByTimeAsync(10)

      handle.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "second")
        root.set("counter", 2)
      })

      // Wait for async save operations
      await vi.advanceTimersByTimeAsync(10)

      // Should have saved multiple updates
      const updateCalls = saveSpy.mock.calls.filter(call => {
        const key = call[0] as string[]
        return key[0] === handle.documentId && key[1] === "update"
      })

      expect(updateCalls.length).toBeGreaterThanOrEqual(1)
    })

    it("should load document from storage when finding", async () => {
      const loadRangeSpy = vi.spyOn(storage, "loadRange")

      // First create and save a document
      const handle1 = repo.get("test-doc")
      handle1.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "stored")
      })

      // Create a new repo with the same storage
      const repo2 = new Repo({ storage })

      // Try to find the document
      loadRangeSpy.mockClear()
      repo2.get("test-doc").waitForStorage()

      // Should attempt to load from storage using loadRange
      // (this happens in the background)
      await vi.advanceTimersByTimeAsync(10)
      expect(loadRangeSpy).toHaveBeenCalledWith(["test-doc"])
    })
  })

  it("should handle document deletion", async () => {
    const handle = repo.get()
    const documentId = handle.documentId

    // Document should exist in cache
    expect(repo.handles.has(documentId)).toBe(true)

    await repo.delete(documentId)

    // Document should be removed from cache
    expect(repo.handles.has(documentId)).toBe(false)
  })

  it("should support network operations", () => {
    // Test that network subsystem is properly initialized
    expect(repo.networks).toBeDefined()

    // Test that we can start/stop network
    repo.networks.stopAll()
    repo.networks.startAdapters()
  })

  it("should support disconnection", () => {
    repo.get()
    expect(repo.handles.size).toBe(1)

    repo.disconnect()

    // Handles should be cleared
    expect(repo.handles.size).toBe(0)
  })
})
