import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DocHandle } from "./doc-handle.js"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./network/in-process-network-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

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

  it("should create a new document and return a handle", async () => {
    const handle = await repo.create()
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.state).toBe("ready")
  })

  it("should create a document with a specific ID", async () => {
    const documentId = "custom-doc-id"
    const handle = await repo.create({ documentId })
    expect(handle.documentId).toBe(documentId)
    expect(handle.state).toBe("ready")
  })

  it("should create a document with initial value", async () => {
    const handle = (await repo.create()).change(doc => {
      const root = doc.getMap("root")
      root.set("text", "initial")
    })

    expect(handle.state).toBe("ready")

    // The document should have the initial value
    const doc = handle.doc()
    const root = doc.getMap("root")
    expect(root.get("text")).toBe("initial")
  })

  it("should throw error when creating a document with existing ID", async () => {
    const documentId = "existing-doc"
    await repo.create({ documentId })

    await expect(repo.create({ documentId })).rejects.toThrow(
      `A document with id ${documentId} already exists.`,
    )
  })

  it("should find an existing document handle", async () => {
    const handle = await repo.create()
    const foundHandle = await repo.find(handle.documentId)
    expect(foundHandle).toBe(handle)
  })

  it("should be network-loading if a document is not found in storage or on the network", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: spying on a private method
    const getOrCreateHandleSpy = vi.spyOn(repo as any, "getOrCreateHandle")

    // Start the find operation - this promise will never settle since the doc doesn't exist
    repo.find("non-existent-doc")

    // Capture the first returned handle
    const handle = await getOrCreateHandleSpy.mock.results[0]?.value

    expect(handle.state).toBe("storage-loading")

    await vi.runAllTimersAsync()

    expect(handle.state).toBe("unavailable")

    // Clean up the spy
    getOrCreateHandleSpy.mockRestore()
  })

  it("should create a document if findOrCreate is called for a non-existent doc", async () => {
    const handle = await repo.findOrCreate("non-existent-doc")
    expect(handle.state).toBe("ready")
  })

  it("should find a document from a peer", async () => {
    const broker = new InProcessNetworkBroker()

    const repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      peerId: "repoA",
    })
    const handleA = await repoA.create()
    handleA.change(doc => {
      const root = doc.getMap("root")
      root.set("text", "hello")
    })
    expect(handleA.state).toBe("ready")

    const repoB = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      peerId: "repoB",
    })

    // This should work with the network sync
    const handleB = await repoB.find(handleA.documentId)
    expect(handleB.state).toBe("ready")
    const docB = handleB.doc()
    const rootB = docB.getMap("root")
    expect(rootB.get("text")).toBe("hello")
  })

  // it("should delete a document", async () => {
  //   const handle = await repo.create()
  //   expect(handle.state).toBe("ready")

  //   await repo.delete(handle.documentId)

  //   expect(handle.state).toBe("deleted")
  //   const fromStorage = await storage.load([handle.documentId])
  //   // Storage returns undefined for non-existent items
  //   expect(fromStorage).toBeUndefined()

  //   // Finding a deleted document should fail
  //   await expect(repo.find(handle.documentId)).rejects.toThrow(
  //     "Document not found",
  //   )
  // })

  it("should handle findOrCreate with timeout option", async () => {
    const handle = (
      await repo.findOrCreate("test-doc", {
        timeout: 1000,
      })
    ).change(doc => {
      const root = doc.getMap("root")
      root.set("text", "created")
    })

    expect(handle.state).toBe("ready")
    const doc = handle.doc()
    const root = doc.getMap("root")
    expect(root.get("text")).toBe("created")
  })

  // it("should sync changes between repos", async () => {
  //   const broker = new InProcessNetworkBroker()

  //   const repoA = new Repo({
  //     network: [new InProcessNetworkAdapter(broker)],
  //     peerId: "repoA",
  //   })
  //   const repoB = new Repo({
  //     network: [new InProcessNetworkAdapter(broker)],
  //     peerId: "repoB",
  //   })

  //   // Create document in repoA
  //   const handleA = await repoA.create()
  //   handleA.change(doc => {
  //     const root = doc.getMap("root")
  //     root.set("text", "initial")
  //   })

  //   // Find document in repoB
  //   const handleB = await repoB.find(handleA.documentId)

  //   // Make a change in repoB
  //   handleB.change(doc => {
  //     const root = doc.getMap("root")
  //     root.set("text", "updated from B")
  //   })

  //   // Use a small delay to allow sync to propagate
  //   await new Promise(resolve => setTimeout(resolve, 100))

  //   // Check that repoA has the update
  //   expect(handleA.doc().toJSON()).toMatchObject({ root: { text: "updated from B" } })
  // })
})
