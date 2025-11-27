import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

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
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter1" })],
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter2" })],
    })

    // Repo 1 creates a document
    const handle1 = repo1.get("the-doc-id")
    expect(handle1.doc).toBeDefined()

    // Mutate the document
    handle1.change(doc => {
      doc.getMap("doc").set("text", "hello")
    })
    expect(handle1.doc.getMap("doc").toJSON()).toEqual({ text: "hello" })

    // Repo 2 finds the document and waits for network sync
    const handle2 = repo2.get("the-doc-id")
    await handle2.waitForNetwork()

    expect(handle2.doc.getMap("doc").toJSON()).toEqual({ text: "hello" })

    // Mutate the document from repo 2
    handle2.change(doc => {
      const root = doc.getMap("doc")
      root.get("text")
      root.set("text", `${root.get("text")} world`)
    })
    expect(handle2.doc.getMap("doc").toJSON()).toEqual({
      text: "hello world",
    })

    // Wait for the change to propagate back to repo 1
    await vi.runAllTimersAsync()
    expect(handle1.doc.getMap("doc").toJSON()).toEqual({
      text: "hello world",
    })
  }, 500)

  it("should not apply a change if a peer is not allowed to write", async () => {
    const bridge = new Bridge()
    let repo1CanWrite = true

    const repo1 = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter1" })],
      rules: {
        canUpdate: () => repo1CanWrite,
      },
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter2" })],
    })

    const handle1 = repo1.get(crypto.randomUUID())

    // Wait for network connections to establish
    await vi.advanceTimersByTimeAsync(100)

    const handle2 = repo2.get(handle1.docId)
    await handle2.waitForNetwork()

    // A change from a permitted peer should be applied
    handle2.change(doc => {
      doc.getMap("doc").set("text", "hello")
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(handle1.doc.getMap("doc").toJSON()).toEqual({ text: "hello" })

    // A change from a non-permitted peer should not be applied
    repo1CanWrite = false
    handle2.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", `${root.get("text")} world`)
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(handle1.doc.getMap("doc").toJSON()).toEqual({ text: "hello" })
  }, 500)

  it("should not delete a document if a peer is not allowed to", async () => {
    const bridge = new Bridge()
    const repo1 = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter1" })],
      rules: { canDelete: () => false },
    })
    const repo2 = new Repo({
      identity: { name: "repo2", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "adapter2" })],
    })

    const handle1 = repo1.get(crypto.randomUUID())

    // Wait for network connections to establish
    await vi.advanceTimersByTimeAsync(100)

    const handle2 = repo2.get(handle1.docId)
    await handle2.waitForNetwork()

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

    it("should reveal all documents when canReveal is always true", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterA" })],
        rules: { canReveal: () => true },
      })
      const handle1 = repoA.get(crypto.randomUUID())
      const handle2 = repoA.get(crypto.randomUUID())

      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterB" })],
      })

      // Wait for the repos to connect and exchange messages
      await vi.runAllTimersAsync()

      expect(repoB.has(handle1.docId)).toBe(true)
      expect(repoB.has(handle2.docId)).toBe(true)

      const bHandle1 = repoB.get(handle1.docId)
      const bHandle2 = repoB.get(handle2.docId)

      expect(bHandle1.doc).toBeDefined()
      expect(bHandle2.doc).toBeDefined()
    }, 500)

    it("should not announce documents when canReveal is false", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterA" })],
        rules: { canReveal: () => false },
      })
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterB" })],
      })

      repoA.get(crypto.randomUUID()) // Create a document that will not be announced
      await vi.runAllTimersAsync()

      // B should not know about the doc, because it was not announced
      // Note: We can't check handles.size directly as it's private, but we can check specific docIds
      // For this test, we'll just verify that attempting to get a non-existent doc creates a new empty one
      const docCount = Array.from(
        repoB.synchronizer.model.documents.keys(),
      ).length
      expect(docCount).toBe(0)
    }, 500)

    it("should sync a document on direct request even if not announced", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterA" })],
        rules: { canReveal: () => false },
      })
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterB" })],
      })

      const handleA = repoA.get(crypto.randomUUID())
      handleA.change(doc => {
        doc.getMap("doc").set("text", "hello")
      })

      // Wait for network connections to establish
      await vi.advanceTimersByTimeAsync(100)

      // B explicitly requests the document. It should succeed.
      const handleB = repoB.get(handleA.docId)
      await handleB.waitForNetwork()

      expect(handleB.doc.getMap("doc").toJSON()).toEqual({ text: "hello" })
    }, 500)

    it("should selectively announce documents based on permissions", async () => {
      repoA = new Repo({
        identity: { name: "repoA", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterA" })],
        rules: {
          canReveal: context => context.docId.startsWith("allowed"),
        },
      })

      // Create documents and make changes BEFORE repoB connects
      const handle1 = repoA.get("allowed-doc-1")
      handle1.change(doc => doc.getMap("doc").set("test", "1"))

      const handle2 = repoA.get("denied-doc-1")
      handle2.change(doc => doc.getMap("doc").set("test", "2"))

      const handle3 = repoA.get("allowed-doc-2")
      handle3.change(doc => doc.getMap("doc").set("test", "3"))

      // Now create repoB - it should receive announcements based on canReveal
      repoB = new Repo({
        identity: { name: "repoB", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterId: "adapterB" })],
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
      const handle1 = repo1.get(documentId)

      // Add some content
      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("title", "My Document")
        root.set("content", "This should persist")
        root.set("count", 42)
      })

      // Get the snapshot for comparison
      const snapshot1 = handle1.doc.export({ mode: "snapshot" })

      // Wait for storage operations to complete
      await vi.runAllTimersAsync()

      // Create a second repo instance with a fresh storage adapter that shares the same data
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      // Try to find the document - it should load from storage
      const handle2 = repo2.get(documentId)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      // Verify the document was loaded correctly
      const root2 = handle2.doc.getMap("doc")
      expect(root2.get("title")).toBe("My Document")
      expect(root2.get("content")).toBe("This should persist")
      expect(root2.get("count")).toBe(42)

      // The snapshots should be equivalent
      const snapshot2 = handle2.doc.export({ mode: "snapshot" })
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
      const handle1 = repo1.get(documentId)

      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("items", ["item1", "item2"])
      })

      // Wait for storage save to complete
      await vi.runAllTimersAsync()

      // Second session: load document from storage with fresh adapter
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      const handle2 = repo2.get(documentId)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      // Verify initial content loaded from storage
      const root2 = handle2.doc.getMap("doc")
      expect(root2.get("items")).toEqual(["item1", "item2"])

      // Make additional changes
      handle2.change(doc => {
        const root = doc.getMap("doc")
        const items = root.get("items") as string[]
        root.set("items", [...items, "item3"])
      })

      await vi.runAllTimersAsync()

      // Third session: verify all changes are persisted in storage with fresh adapter
      const storage3 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo3 = new Repo({
        identity: { name: "repo3", type: "user" },
        adapters: [storage3],
      })

      const handle3 = repo3.get(documentId)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      const root3 = handle3.doc.getMap("doc")
      expect(root3.get("items")).toEqual(["item1", "item2", "item3"])
    }, 500)

    it("should save and load documents with complex nested structures", async () => {
      const storage1 = new InMemoryStorageAdapter()

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [storage1],
      })

      // Wait for storage to be ready
      await vi.runAllTimersAsync()

      const documentId = "complex-doc"
      const handle1 = repo1.get(documentId)

      // Create a complex nested structure
      handle1.change(doc => {
        const root = doc.getMap("doc")

        // Add nested maps
        const user = doc.getMap("user")
        user.set("name", "Alice")
        user.set("age", 30)

        const preferences = doc.getMap("preferences")
        preferences.set("theme", "dark")
        preferences.set("notifications", true)
        user.setContainer("preferences", preferences)

        root.setContainer("user", user)

        // Add lists
        const todos = doc.getList("todos")
        todos.push("Task 1")
        todos.push("Task 2")
        todos.push("Task 3")
        root.setContainer("todos", todos)

        // Add nested list of maps
        const comments = doc.getList("comments")
        const comment1 = doc.getMap("comment1")
        comment1.set("author", "Bob")
        comment1.set("text", "Great work!")
        comments.pushContainer(comment1)

        const comment2 = doc.getMap("comment2")
        comment2.set("author", "Charlie")
        comment2.set("text", "Thanks!")
        comments.pushContainer(comment2)

        root.setContainer("comments", comments)
      })

      await vi.runAllTimersAsync()

      // Load in new repo instance with fresh adapter
      const storage2 = new InMemoryStorageAdapter(storage1.getStorage())
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [storage2],
      })

      const handle2 = repo2.get(documentId)

      // Allow time for storage channel to establish and respond
      await vi.runAllTimersAsync()

      // Verify complex structure is preserved
      const root2 = handle2.doc.getMap("doc")

      const user2 = root2.get("user") as any
      expect(user2.get("name")).toBe("Alice")
      expect(user2.get("age")).toBe(30)

      const preferences2 = user2.get("preferences") as any
      expect(preferences2.get("theme")).toBe("dark")
      expect(preferences2.get("notifications")).toBe(true)

      const todos2 = root2.get("todos") as any
      expect(todos2.toArray()).toEqual(["Task 1", "Task 2", "Task 3"])

      const comments2 = root2.get("comments") as any
      const commentsArray = comments2.toArray()
      expect(commentsArray[0].get("author")).toBe("Bob")
      expect(commentsArray[0].get("text")).toBe("Great work!")
      expect(commentsArray[1].get("author")).toBe("Charlie")
      expect(commentsArray[1].get("text")).toBe("Thanks!")
    }, 500)
  })
})
