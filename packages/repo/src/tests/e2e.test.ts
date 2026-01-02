import { Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { InMemoryStorageAdapter } from "../storage/in-memory-storage-adapter.js"

// Typed schema for document tests - using text container for string content
const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
})

// Schema for storage tests with struct for plain values
const StorageDocSchema = Shape.doc({
  data: Shape.struct({
    title: Shape.plain.string(),
    content: Shape.plain.string(),
    count: Shape.plain.number(),
  }),
})

// Integration test suite for the Repo
describe("Repo E2E", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should synchronize a document between two repos", async () => {
    const bridge = new Bridge()
    const repo1 = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
    })

    // Repo 1 creates a document
    const handle1 = repo1.get("the-doc-id", DocSchema)
    expect(handle1.doc).toBeDefined()

    // Mutate the document using typed API
    handle1.change(draft => {
      draft.title.insert(0, "hello")
    })
    expect(handle1.doc.toJSON().title).toBe("hello")

    // Repo 2 finds the document and waits for network sync
    const handle2 = repo2.get("the-doc-id", DocSchema)
    await handle2.waitForSync({ timeout: 0 })

    expect(handle2.doc.toJSON().title).toBe("hello")

    // Mutate the document from repo 2
    handle2.change(draft => {
      draft.title.insert(5, " world")
    })
    expect(handle2.doc.toJSON().title).toBe("hello world")

    // Wait for the change to propagate back to repo 1
    await vi.runAllTimersAsync()
    expect(handle1.doc.toJSON().title).toBe("hello world")
  }, 500)

  it("should not apply a change if a peer is not allowed to write", async () => {
    const bridge = new Bridge()
    let repo1CanWrite = true

    const repo1 = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      permissions: {
        mutability: () => repo1CanWrite,
      },
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
    })

    const handle1 = repo1.get(crypto.randomUUID(), DocSchema)

    // Wait for network connections to establish
    await vi.advanceTimersByTimeAsync(100)

    const handle2 = repo2.get(handle1.docId, DocSchema)
    await handle2.waitForSync({ timeout: 0 })

    // A change from a permitted peer should be applied
    handle2.change(draft => {
      draft.title.insert(0, "hello")
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(handle1.doc.toJSON().title).toBe("hello")

    // A change from a non-permitted peer should not be applied
    repo1CanWrite = false
    handle2.change(draft => {
      draft.title.insert(5, " world")
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(handle1.doc.toJSON().title).toBe("hello")
  }, 500)

  it("should not delete a document if a peer is not allowed to", async () => {
    const bridge = new Bridge()
    const repo1 = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      permissions: { deletion: () => false },
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
    })

    const handle1 = repo1.get(crypto.randomUUID(), DocSchema)

    // Wait for network connections to establish
    await vi.advanceTimersByTimeAsync(100)

    const handle2 = repo2.get(handle1.docId, DocSchema)
    await handle2.waitForSync({ timeout: 0 })

    await repo2.delete(handle1.docId)

    await vi.advanceTimersByTimeAsync(100)

    // The document should still exist in repo1
    expect(repo1.has(handle1.docId)).toBe(true)
  }, 500)

  describe("canReveal permission", () => {
    let bridge: Bridge
    let repoA: Repo
    let repoB: Repo

    beforeEach(() => {
      bridge = new Bridge()
    })

    it("should reveal all documents when visibility is always true", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
        permissions: { visibility: () => true },
      })
      const handle1 = repoA.get(crypto.randomUUID(), DocSchema)
      const handle2 = repoA.get(crypto.randomUUID(), DocSchema)

      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterB" })],
      })

      // Wait for the repos to connect and exchange messages
      await vi.runAllTimersAsync()

      expect(repoB.has(handle1.docId)).toBe(true)
      expect(repoB.has(handle2.docId)).toBe(true)

      const bHandle1 = repoB.get(handle1.docId, DocSchema)
      const bHandle2 = repoB.get(handle2.docId, DocSchema)

      expect(bHandle1.doc).toBeDefined()
      expect(bHandle2.doc).toBeDefined()
    }, 500)

    it("should not announce documents when visibility is false", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
        permissions: { visibility: () => false },
      })
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterB" })],
      })

      repoA.get(crypto.randomUUID(), DocSchema) // Create a document that will not be announced
      await vi.runAllTimersAsync()

      // B should not know about the doc, because it was not announced
      const docCount = Array.from(
        repoB.synchronizer.model.documents.keys(),
      ).length
      expect(docCount).toBe(0)
    }, 500)

    it("should sync a document on direct request even if not announced", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
        permissions: { visibility: () => false },
      })
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterB" })],
      })

      const handleA = repoA.get(crypto.randomUUID(), DocSchema)
      handleA.change(draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for network connections to establish
      await vi.advanceTimersByTimeAsync(100)

      // B explicitly requests the document. It should succeed.
      const handleB = repoB.get(handleA.docId, DocSchema)
      await handleB.waitForSync({ timeout: 0 })

      expect(handleB.doc.toJSON().title).toBe("hello")
    }, 500)

    it("should selectively announce documents based on permissions", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
        permissions: {
          visibility: doc => doc.id.startsWith("allowed"),
        },
      })

      // Create documents and make changes BEFORE repoB connects
      const handle1 = repoA.get("allowed-doc-1", DocSchema)
      handle1.change(draft => {
        draft.title.insert(0, "1")
      })

      const handle2 = repoA.get("denied-doc-1", DocSchema)
      handle2.change(draft => {
        draft.title.insert(0, "2")
      })

      const handle3 = repoA.get("allowed-doc-2", DocSchema)
      handle3.change(draft => {
        draft.title.insert(0, "3")
      })

      // Now create repoB - it should receive announcements based on canReveal
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapterB" })],
      })

      // Wait for repos to connect and exchange messages
      await vi.runAllTimersAsync()

      expect(repoB.has("allowed-doc-1")).toBe(true)
      expect(repoB.has("allowed-doc-2")).toBe(true)
      expect(repoB.has("denied-doc-1")).toBe(false)
    })
  }, 500)

  describe("storage persistence", () => {
    it("should persist and load documents across repo instances", async () => {
      const storage1 = new InMemoryStorageAdapter()

      // Create first repo instance and create a document
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [storage1],
      })

      // Wait for storage to be ready
      await vi.runAllTimersAsync()

      const documentId = "persistent-doc"
      const handle1 = repo1.get(documentId, StorageDocSchema)

      // Add some content
      handle1.change(draft => {
        draft.data.title = "My Document"
        draft.data.content = "This should persist"
        draft.data.count = 42
      })

      // Get the snapshot for comparison
      const snapshot1 = handle1.loroDoc.export({ mode: "snapshot" })

      // Wait for storage operations to complete
      await vi.runAllTimersAsync()

      // Create a second repo instance with a fresh storage adapter that shares the same data
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      // Try to find the document - it should load from storage
      const handle2 = repo2.get(documentId, StorageDocSchema)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      // Verify the document was loaded correctly
      const doc2 = handle2.doc.toJSON()
      expect(doc2.data.title).toBe("My Document")
      expect(doc2.data.content).toBe("This should persist")
      expect(doc2.data.count).toBe(42)

      // The snapshots should be equivalent
      const snapshot2 = handle2.loroDoc.export({ mode: "snapshot" })
      expect(snapshot2).toEqual(snapshot1)
    }, 500)

    it("should handle incremental updates across sessions", async () => {
      const storage1 = new InMemoryStorageAdapter()

      // First session: create document with initial content
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [storage1],
      })

      // Wait for storage to be ready
      await vi.runAllTimersAsync()

      const documentId = "incremental-doc"
      const handle1 = repo1.get(documentId, DocSchema)

      handle1.change(draft => {
        draft.title.insert(0, "item1,item2")
        draft.count.increment(2)
      })

      // Wait for storage save to complete
      await vi.runAllTimersAsync()

      // Second session: load document from storage with fresh adapter
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      const handle2 = repo2.get(documentId, DocSchema)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      // Verify initial content loaded from storage
      expect(handle2.doc.toJSON().title).toBe("item1,item2")
      expect(handle2.doc.toJSON().count).toBe(2)

      // Make additional changes
      handle2.change(draft => {
        draft.title.insert(draft.title.toString().length, ",item3")
        draft.count.increment(1)
      })

      await vi.runAllTimersAsync()

      // Third session: verify all changes are persisted in storage with fresh adapter
      const storage3 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo3 = new Repo({
        identity: { name: "repo3", type: "user" },
        adapters: [storage3],
      })

      const handle3 = repo3.get(documentId, DocSchema)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      expect(handle3.doc.toJSON().title).toBe("item1,item2,item3")
      expect(handle3.doc.toJSON().count).toBe(3)
    }, 500)

    it("should load stored documents when app creates document after storage establishes", async () => {
      // This test replicates the hono-counter scenario:
      // 1. Storage has a document with data
      // 2. App starts and creates the document via repo.get()
      // 3. App should see the stored data

      const storage1 = new InMemoryStorageAdapter()

      // First session: create document with content
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [storage1],
      })

      await vi.runAllTimersAsync()

      const documentId = "counter"
      const handle1 = repo1.get(documentId, DocSchema)

      handle1.change(draft => {
        draft.count.increment(42)
      })

      await vi.runAllTimersAsync()

      // Verify data was saved
      expect(handle1.doc.toJSON().count).toBe(42)

      // Second session: new repo with same storage, app creates document
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      // App creates the document (like useDocument does)
      const handle2 = repo2.get(documentId, DocSchema)

      // Wait for storage to establish and sync
      await vi.runAllTimersAsync()

      // The document should have the stored data
      expect(handle2.doc.toJSON().count).toBe(42)
    }, 500)

    it("should load stored documents with async storage operations", async () => {
      // This test simulates IndexedDB-like async behavior where
      // storage operations take real time

      // Create a delayed storage adapter that simulates async operations
      class DelayedStorageAdapter extends InMemoryStorageAdapter {
        private delay = 10 // ms

        async loadRange(
          keyPrefix: string[],
        ): Promise<{ key: string[]; data: Uint8Array }[]> {
          await new Promise(resolve => setTimeout(resolve, this.delay))
          return super.loadRange(keyPrefix)
        }
      }

      const storage1 = new DelayedStorageAdapter()

      // First session: create document with content
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [storage1],
      })

      await vi.runAllTimersAsync()

      const documentId = "counter"
      const handle1 = repo1.get(documentId, DocSchema)

      handle1.change(draft => {
        draft.count.increment(42)
      })

      await vi.runAllTimersAsync()

      // Second session: new repo with same storage
      const storage2 = new DelayedStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      // App creates the document immediately (like useDocument does)
      const handle2 = repo2.get(documentId, DocSchema)

      // Wait for async storage operations to complete
      await vi.runAllTimersAsync()

      // The document should have the stored data
      expect(handle2.doc.toJSON().count).toBe(42)
    }, 500)
  })

  describe("loroDoc escape hatch", () => {
    it("should allow direct LoroDoc access for advanced use cases", async () => {
      const bridge = new Bridge()
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const handle = repo1.get("escape-hatch-doc", DocSchema)

      // Access the raw LoroDoc
      const loroDoc = handle.loroDoc
      expect(loroDoc).toBeDefined()

      // Make changes directly (requires commit)
      loroDoc.getMap("title").set("raw", "value")
      loroDoc.commit()

      // Changes should be visible via raw access
      expect(loroDoc.getMap("title").get("raw")).toBe("value")
    }, 500)
  })
})
