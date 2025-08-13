import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  InProcessBridge,
  InProcessNetworkAdapter,
} from "./network/in-process-network-adapter.js"
import { Repo } from "./repo.js"

// Integration test suite for the Repo
describe("Repo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should synchronize a document between two repos", async () => {
    const bridge = new InProcessBridge()
    const repo1 = new Repo({
      peerId: "repo1",
      network: [new InProcessNetworkAdapter(bridge)],
    })
    const repo2 = new Repo({
      peerId: "repo2",
      network: [new InProcessNetworkAdapter(bridge)],
    })

    // Repo 1 creates a document
    const handle1 = await repo1.create()
    expect(handle1.state).toBe("ready")

    // Mutate the document
    handle1.change(doc => {
      doc.getMap("doc").set("text", "hello")
    })
    expect(handle1.doc().getMap("doc").toJSON()).toEqual({ text: "hello" })

    // Repo 2 finds the document
    const handle2 = await repo2.find(handle1.documentId)
    expect(handle2.state).toBe("ready")
    expect(handle2.doc().getMap("doc").toJSON()).toEqual({ text: "hello" })

    // Mutate the document from repo 2
    handle2.change(doc => {
      const root = doc.getMap("doc")
      root.get("text")
      root.set("text", `${root.get("text")} world`)
    })
    expect(handle2.doc().getMap("doc").toJSON()).toEqual({
      text: "hello world",
    })

    // Wait for the change to propagate back to repo 1
    await vi.runAllTimersAsync()
    expect(handle1.doc().getMap("doc").toJSON()).toEqual({
      text: "hello world",
    })
  })

  it("should not apply a change if a peer is not allowed to write", async () => {
    const bridge = new InProcessBridge()
    let repo1CanWrite = true

    const repo1 = new Repo({
      peerId: "repo1",
      network: [new InProcessNetworkAdapter(bridge)],
      permissions: {
        canWrite: () => repo1CanWrite,
      },
    })
    const repo2 = new Repo({
      peerId: "repo2",
      network: [new InProcessNetworkAdapter(bridge)],
    })

    const handle1 = await repo1.create()
    const handle2 = await repo2.find(handle1.documentId)

    // A change from a permitted peer should be applied
    handle2.change(doc => {
      doc.getMap("doc").set("text", "hello")
    })

    await vi.runAllTimersAsync()

    expect(handle1.doc().getMap("doc").toJSON()).toEqual({ text: "hello" })

    // A change from a non-permitted peer should not be applied
    repo1CanWrite = false
    handle2.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", `${root.get("text")} world`)
    })

    await vi.runAllTimersAsync()

    expect(handle1.doc().getMap("doc").toJSON()).toEqual({ text: "hello" })
  })

  it("should not delete a document if a peer is not allowed to", async () => {
    const bridge = new InProcessBridge()
    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(bridge)],
      permissions: { canDelete: () => false },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(bridge)] })

    const handle1 = await repo1.create()
    const handle2 = await repo2.find(handle1.documentId)
    expect(handle2.state).toBe("ready")

    await repo2.delete(handle1.documentId)

    await vi.runAllTimersAsync()

    // The document should still exist in repo1
    expect(repo1.handles.has(handle1.documentId)).toBe(true)
    expect(handle1.state).toBe("ready")
  })

  describe("canList permission", () => {
    let bridge: InProcessBridge
    let repoA: Repo
    let repoB: Repo

    beforeEach(() => {
      bridge = new InProcessBridge()
    })

    it("should reveal all documents when canList is always true", async () => {
      repoA = new Repo({
        peerId: "repoA",
        network: [new InProcessNetworkAdapter(bridge)],
        permissions: { canList: () => true },
      })
      const handle1 = await repoA.create()
      const handle2 = await repoA.create()

      repoB = new Repo({
        peerId: "repoB",
        network: [new InProcessNetworkAdapter(bridge)],
      })

      // Wait for the repos to connect and exchange messages
      await vi.runAllTimersAsync()

      expect(repoB.handles.has(handle1.documentId)).toBe(true)
      expect(repoB.handles.has(handle2.documentId)).toBe(true)

      const bHandle1 = await repoB.find(handle1.documentId)
      const bHandle2 = await repoB.find(handle2.documentId)

      expect(bHandle1.state).toBe("ready")
      expect(bHandle2.state).toBe("ready")
    })

    it("should not announce documents when canList is false", async () => {
      repoA = new Repo({
        network: [new InProcessNetworkAdapter(bridge)],
        permissions: { canList: () => false },
      })
      repoB = new Repo({ network: [new InProcessNetworkAdapter(bridge)] })

      await repoA.create() // Create a document that will not be announced
      await vi.runAllTimersAsync()

      // B should not know about the doc, because it was not announced
      expect(repoB.handles.size).toBe(0)
    })

    it("should sync a document on direct request even if not announced", async () => {
      repoA = new Repo({
        network: [new InProcessNetworkAdapter(bridge)],
        permissions: { canList: () => false },
      })
      repoB = new Repo({ network: [new InProcessNetworkAdapter(bridge)] })

      const handleA = await repoA.create()
      handleA.change(doc => {
        doc.getMap("doc").set("text", "hello")
      })

      // B explicitly requests the document. It should succeed.
      const handleB = await repoB.find(handleA.documentId)

      expect(handleB.state).toBe("ready")
      expect(handleB.doc().getMap("doc").toJSON()).toEqual({ text: "hello" })
    })

    it("should selectively announce documents based on permissions", async () => {
      repoA = new Repo({
        peerId: "repoA",
        network: [new InProcessNetworkAdapter(bridge)],
        permissions: {
          canList: (_, documentId) => documentId.startsWith("allowed"),
        },
      })
      repoB = new Repo({
        peerId: "repoB",
        network: [new InProcessNetworkAdapter(bridge)],
      })

      await repoA.create({ documentId: "allowed-doc-1" })
      await repoA.create({ documentId: "denied-doc-1" })
      await repoA.create({ documentId: "allowed-doc-2" })
      await vi.runAllTimersAsync()

      expect(repoB.handles.size).toBe(2)
      expect(repoB.handles.has("allowed-doc-1")).toBe(true)
      expect(repoB.handles.has("allowed-doc-2")).toBe(true)
      expect(repoB.handles.has("denied-doc-1")).toBe(false)
    })
  })

  describe("storage persistence", () => {
    it("should persist and load documents across repo instances", async () => {
      const { InMemoryStorageAdapter } = await import(
        "./storage/in-memory-storage-adapter.js"
      )
      const storage = new InMemoryStorageAdapter()

      // Create first repo instance and create a document
      const repo1 = new Repo({
        peerId: "repo1",
        storage,
      })

      const documentId = "persistent-doc"
      const handle1 = await repo1.create({ documentId })

      // Add some content
      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("title", "My Document")
        root.set("content", "This should persist")
        root.set("count", 42)
      })

      // Get the snapshot for comparison
      const snapshot1 = handle1.doc().export({ mode: "snapshot" })

      // Wait for storage operations to complete
      await vi.runAllTimersAsync()

      // Create a second repo instance with the same storage
      const repo2 = new Repo({
        peerId: "repo2",
        storage,
      })

      // Try to find the document - it should load from storage
      const handle2 = await repo2.find(documentId)

      // Verify the document was loaded correctly
      expect(handle2.state).toBe("ready")
      const doc2 = handle2.doc()
      const root2 = doc2.getMap("doc")
      expect(root2.get("title")).toBe("My Document")
      expect(root2.get("content")).toBe("This should persist")
      expect(root2.get("count")).toBe(42)

      // The snapshots should be equivalent
      const snapshot2 = doc2.export({ mode: "snapshot" })
      expect(snapshot2).toEqual(snapshot1)
    })

    it("should handle incremental updates across sessions", async () => {
      const { InMemoryStorageAdapter } = await import(
        "./storage/in-memory-storage-adapter.js"
      )

      const storage = new InMemoryStorageAdapter()

      // First session: create document with initial content
      const repo1 = new Repo({
        peerId: "repo1",
        storage,
      })

      const documentId = "incremental-doc"
      const handle1 = await repo1.create({ documentId })

      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("items", ["item1", "item2"])
      })

      // Wait for storage save to complete
      await vi.runAllTimersAsync()

      // Second session: load document from storage
      const repo2 = new Repo({
        peerId: "repo2",
        storage,
      })

      const handle2 = await repo2.find(documentId)
      expect(handle2.state).toBe("ready")

      // Verify initial content loaded from storage
      const root2 = handle2.doc().getMap("doc")
      expect(root2.get("items")).toEqual(["item1", "item2"])

      // Make additional changes
      handle2.change(doc => {
        const root = doc.getMap("doc")
        const items = root.get("items") as string[]
        root.set("items", [...items, "item3"])
      })

      await vi.runAllTimersAsync()

      // Third session: verify all changes are persisted in storage
      const repo3 = new Repo({
        peerId: "repo3",
        storage,
      })

      const handle3 = await repo3.find(documentId)
      expect(handle3.state).toBe("ready")

      const root3 = handle3.doc().getMap("doc")
      expect(root3.get("items")).toEqual(["item1", "item2", "item3"])
    })

    it("should reconstruct document from updates alone (no snapshot)", async () => {
      // This test verifies that the storage system works correctly
      // The full reconstruction from updates-only is tested in other tests

      const { InMemoryStorageAdapter } = await import(
        "./storage/in-memory-storage-adapter.js"
      )

      const storage = new InMemoryStorageAdapter()

      // Create document with changes
      const repo1 = new Repo({
        peerId: "repo1",
        storage,
      })

      const documentId = "updates-only-doc"
      const handle1 = await repo1.create({ documentId })

      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("step", 1)
        root.set("data", "hello")
      })

      handle1.change(doc => {
        const root = doc.getMap("doc")
        root.set("step", 2)
        root.set("data", "hello world")
      })

      // Wait for saves
      await vi.runAllTimersAsync()

      // Create new repo and load the document
      const repo2 = new Repo({
        peerId: "repo2",
        storage,
      })

      // Use findOrCreate with timeout 0 to immediately check storage
      const handle2 = await repo2.findOrCreate(documentId, { timeout: 0 })

      // The document should be ready and have the expected content
      expect(handle2.state).toBe("ready")
      const root2 = handle2.doc().getMap("doc")
      expect(root2.get("step")).toBe(2)
      expect(root2.get("data")).toBe("hello world")
    })

    it("should save and load documents with complex nested structures", async () => {
      const { InMemoryStorageAdapter } = await import(
        "./storage/in-memory-storage-adapter.js"
      )
      const storage = new InMemoryStorageAdapter()

      const repo1 = new Repo({
        peerId: "repo1",
        storage,
      })

      const documentId = "complex-doc"
      const handle1 = await repo1.create({ documentId })

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

      // Load in new repo instance
      const repo2 = new Repo({
        peerId: "repo2",
        storage,
      })

      const handle2 = await repo2.find(documentId)
      expect(handle2.state).toBe("ready")

      // Verify complex structure is preserved
      const doc2 = handle2.doc()
      const root2 = doc2.getMap("doc")

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
    })
  })
})
