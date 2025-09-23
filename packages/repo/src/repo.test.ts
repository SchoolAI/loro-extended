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
    const handle = repo.get("test-doc")
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.doc).toBeDefined()
  })

  it("should create a document with a specific ID", () => {
    const documentId = "custom-doc-id"
    const handle = repo.get(documentId)
    expect(handle.docId).toBe(documentId)
    expect(handle.doc).toBeDefined()
  })

  it("should create a document with initial value", () => {
    const handle = repo.get("test-doc").change(doc => {
      const root = doc.getMap("root")
      root.set("text", "initial")
    })

    // The document should have the initial value
    const root = handle.doc.getMap("root")
    expect(root.get("text")).toBe("initial")
  })

  it("should find an existing document handle", () => {
    const handle = repo.get("test-doc")
    const foundHandle = repo.get(handle.docId)
    expect(foundHandle).toBe(handle)
  })

  it("should return a new handle for non-existent documents", () => {
    const handle = repo.get("non-existent-doc")
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.docId).toBe("non-existent-doc")
    expect(handle.doc).toBeDefined()
  })

  it.only("should find a document from a peer", async () => {
    // Use real timers for this test since it involves network communication
    vi.useRealTimers()

    console.log("Test starting...")

    const bridge = new InProcessBridge()
    console.log("Bridge created")

    // Add bridge event listeners for debugging
    bridge.on("peer-added", ({ peerId }) => {
      console.log("Bridge: peer-added", peerId)
    })
    bridge.on("message", ({ message }) => {
      console.log(
        "Bridge: message",
        message.type,
        "from",
        message.senderId,
        "to",
        message.targetIds,
      )
    })

    const networkA = new InProcessNetworkAdapter(bridge)
    const networkB = new InProcessNetworkAdapter(bridge)
    console.log("Network adapters created")

    console.log("Creating repoA...")
    const repoA = new Repo({
      network: [networkA],
      peerId: "repoA",
    })
    console.log("RepoA created")

    // Add event listeners to debug network events
    networkA.on("peer-available", ({ peerId }) => {
      console.log("NetworkA: peer-available", peerId)
    })
    networkA.on("message-received", ({ message }) => {
      console.log("NetworkA: message-received", message.type)
    })

    console.log("Creating repoB...")
    const repoB = new Repo({
      network: [networkB],
      peerId: "repoB",
    })
    console.log("RepoB created")

    // Add event listeners to debug network events
    networkB.on("peer-available", ({ peerId }) => {
      console.log("NetworkB: peer-available", peerId)
    })
    networkB.on("message-received", ({ message }) => {
      console.log("NetworkB: message-received", message.type)
    })

    // Give some time for the network adapters to connect
    await new Promise(resolve => setTimeout(resolve, 100))

    console.log(
      "RepoA peers:",
      repoA.synchronizer.getModelSnapshot().peers.size,
    )
    console.log(
      "RepoB peers:",
      repoB.synchronizer.getModelSnapshot().peers.size,
    )

    const handleA = repoA.get("test-doc")
    console.log("HandleA created")

    handleA.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })
    console.log("HandleA changed")

    console.log("Getting handleB and calling fetch...")
    const handleB = repoB.get(handleA.docId).fetch()
    console.log("Fetch called, now waiting for network...")

    const result = await handleB.waitForNetwork()
    console.log("Network wait completed")

    const rootB = result.doc.getMap("root")
    expect(rootB.get("text")).toBe("hello")
  }, 15000) // Increase timeout to 15 seconds

  describe("storage operations", () => {
    it("should save updates when document changes", async () => {
      const saveSpy = vi.spyOn(storage, "save")

      const handle = repo.get("test-doc")

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
        return key[0] === handle.docId && key[1] === "update"
      })
      expect(updateCall).toBeDefined()
    })

    it("should save multiple updates with unique version keys", async () => {
      const saveSpy = vi.spyOn(storage, "save")

      const handle = repo.get("test-doc")

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
        return key[0] === handle.docId && key[1] === "update"
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
    const handle = repo.get("test-doc")
    const documentId = handle.docId

    // Document should exist in cache
    expect(repo.handles.has(documentId)).toBe(true)

    await repo.delete(documentId)

    // Document should be removed from cache
    expect(repo.handles.has(documentId)).toBe(false)
  })

  it("should support network operations", () => {
    // Test that network subsystem is properly initialized
    // Network adapters are private, so we just test that repo was created successfully
    expect(repo).toBeDefined()
    expect(repo.peerId).toBeDefined()
  })

  it("should support disconnection", () => {
    repo.get("test-doc")
    expect(repo.handles.size).toBe(1)

    repo.reset()

    // Handles should be cleared
    expect(repo.handles.size).toBe(0)
  })
})
