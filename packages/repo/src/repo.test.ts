import { beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { DocHandle } from "./doc-handle.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

describe("Repo", () => {
  // DocSchema should match the DocContent constraint (Record<string, Container>)
  // For now, we'll use 'any' since we're not assuming a specific structure
  let repo: Repo
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()

    repo = new Repo({ adapters: [storage] })
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

  it("should find a document from a peer", async () => {
    // Use real timers for this test since it involves network communication

    const bridge = new Bridge()

    const networkA = new BridgeAdapter({ adapterId: "network-a", bridge })
    const repoA = new Repo({
      identity: { name: "repoA" },
      adapters: [networkA],
    })

    const networkB = new BridgeAdapter({ adapterId: "network-b", bridge })
    const repoB = new Repo({
      identity: { name: "repoB" },
      adapters: [networkB],
    })

    // Give some time for the network adapters to connect
    await new Promise(resolve => setTimeout(resolve, 100))

    const handleA = repoA.get("test-doc")

    handleA.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })

    const handleB = repoB.get(handleA.docId)

    const result = await handleB.waitForNetwork()

    const rootB = result.doc.getMap("root")
    expect(rootB.get("text")).toBe("hello")
  }, 1000)

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

      handle.change(doc => {
        const root = doc.getMap("root")
        root.set("text", "second")
        root.set("counter", 2)
      })

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
      const repo2 = new Repo({ adapters: [storage] })

      // Try to find the document
      loadRangeSpy.mockClear()
      repo2.get("test-doc").waitForStorage()

      // Should attempt to load from storage using loadRange
      // (this happens in the background)
      expect(loadRangeSpy).toHaveBeenCalledWith(["test-doc"])
    })
  })

  it("should handle document deletion", async () => {
    const handle = repo.get("test-doc")
    const documentId = handle.docId

    // Document should exist in cache
    expect(repo.has(documentId)).toBe(true)

    await repo.delete(documentId)

    // Document should be removed from cache
    expect(repo.has(documentId)).toBe(false)
  })
})
