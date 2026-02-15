import { change, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"
import { Bridge, BridgeAdapter } from "./bridge-adapter.js"

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
})

describe("BridgeAdapter Integration Tests", () => {
  it("should send and receive establishment messages", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Give it a moment for channels to establish
    await new Promise(resolve => setTimeout(resolve, 100))

    // Create a document in repo1
    const docId = "test-doc"
    const doc1 = repo1.get(docId, DocSchema)
    change(doc1, draft => {
      draft.title.insert(0, "value")
    })

    // Get the document in repo2
    const doc2 = repo2.get(docId, DocSchema)

    // Wait for sync
    await sync(doc2).waitForSync({ timeout: 0 })

    // Verify
    expect(doc2.toJSON().title).toBe("value")
  })
  it("should connect two repos through a shared bridge", async () => {
    // Create a shared bridge
    const bridge = new Bridge()

    // Create two repos with bridge adapters
    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Verify both repos are connected through the bridge
    expect(bridge.adapterTypes.has("bridge-adapter-repo1")).toBe(true)
    expect(bridge.adapterTypes.has("bridge-adapter-repo2")).toBe(true)
  })

  it("should synchronize a document from repo1 to repo2", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Create and modify a document in repo1
    const docId = "test-doc-1"
    const doc1 = repo1.get(docId, DocSchema)

    change(doc1, draft => {
      draft.title.insert(0, "Hello from repo1")
      draft.count.increment(42)
    })

    // Get the same document in repo2
    const doc2 = repo2.get(docId, DocSchema)
    await sync(doc2).waitForSync({ timeout: 0 })

    // Verify the document was synchronized
    expect(doc2.toJSON().title).toBe("Hello from repo1")
    expect(doc2.toJSON().count).toBe(42)
  })

  it("should synchronize bidirectional changes between repos", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "bidirectional-doc"

    // Repo1 creates and modifies document
    const doc1 = repo1.get(docId, DocSchema)
    change(doc1, draft => {
      draft.title.insert(0, "from-repo1")
    })

    // Repo2 gets the document and adds to it
    const doc2 = repo2.get(docId, DocSchema)

    change(doc2, draft => {
      draft.count.increment(100)
    })

    await sync(doc2).waitForSync({ timeout: 0 })

    // Verify repo1 received repo2's changes
    expect(doc1.toJSON().title).toBe("from-repo1")
    expect(doc1.toJSON().count).toBe(100)

    // Verify repo2 has both changes
    expect(doc2.toJSON().title).toBe("from-repo1")
    expect(doc2.toJSON().count).toBe(100)
  })

  it("should handle concurrent modifications with CRDT merge semantics", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "concurrent-doc"

    // Both repos get the document
    const doc1 = repo1.get(docId, DocSchema)
    const doc2 = repo2.get(docId, DocSchema)

    // Initialize with some shared state
    change(doc1, draft => {
      draft.title.insert(0, "initialized")
    })

    // Make concurrent modifications (without waiting for sync)
    // Both increment the counter - CRDT will merge them
    change(doc1, draft => {
      draft.count.increment(10)
    })

    change(doc2, draft => {
      draft.count.increment(20)
    })

    await sync(doc2).waitForSync({ timeout: 0 })

    // Both repos should have the merged counter value (10 + 20 = 30)
    expect(doc1.toJSON().count).toBe(30)
    expect(doc2.toJSON().count).toBe(30)
  })

  it("should support multiple documents across the same bridge", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Create multiple documents in repo1
    const doc1A = repo1.get("doc-a", DocSchema)
    const doc1B = repo1.get("doc-b", DocSchema)
    const doc1C = repo1.get("doc-c", DocSchema)

    change(doc1A, draft => draft.title.insert(0, "a"))
    change(doc1B, draft => draft.title.insert(0, "b"))
    change(doc1C, draft => draft.title.insert(0, "c"))

    // Access the same documents in repo2
    const doc2A = repo2.get("doc-a", DocSchema)
    const doc2B = repo2.get("doc-b", DocSchema)
    const doc2C = repo2.get("doc-c", DocSchema)

    await Promise.all([
      sync(doc2A).waitForSync({ timeout: 0 }),
      sync(doc2B).waitForSync({ timeout: 0 }),
      sync(doc2C).waitForSync({ timeout: 0 }),
    ])

    // Verify all documents synchronized correctly
    expect(doc2A.toJSON().title).toBe("a")
    expect(doc2B.toJSON().title).toBe("b")
    expect(doc2C.toJSON().title).toBe("c")
  })

  it("should handle adapter removal and cleanup", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    // Verify both adapters are registered
    expect(bridge.adapterTypes.size).toBe(2)

    // Reset repo1 (should remove its adapter from bridge)
    repo1.reset()

    // Verify adapter was removed
    expect(bridge.adapterTypes.has("bridge-adapter-repo1")).toBe(false)
    expect(bridge.adapterTypes.has("bridge-adapter-repo2")).toBe(true)
    expect(bridge.adapterTypes.size).toBe(1)
  })

  it("should work with more than two repos on the same bridge", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const repo3 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterType: "bridge-adapter-repo3",
        }),
      ],
      identity: { name: "repo3", type: "user" },
    })

    const docId = "shared-doc"

    // Repo1 creates the document
    const doc1 = repo1.get(docId, DocSchema)
    change(doc1, draft => {
      draft.title.insert(0, "repo1")
    })

    // Repo2 and Repo3 should both receive it
    const doc2 = repo2.get(docId, DocSchema)
    const doc3 = repo3.get(docId, DocSchema)

    await Promise.all([
      sync(doc2).waitForSync({ timeout: 0 }),
      sync(doc3).waitForSync({ timeout: 0 }),
    ])

    expect(doc2.toJSON().title).toBe("repo1")
    expect(doc3.toJSON().title).toBe("repo1")

    // Repo2 makes a change
    change(doc2, draft => {
      draft.count.increment(200)
    })

    await Promise.all([
      sync(doc1).waitForSync({ timeout: 0 }),
      sync(doc3).waitForSync({ timeout: 0 }),
    ])

    // Both repo1 and repo3 should receive the change
    expect(doc1.toJSON().count).toBe(200)
    expect(doc3.toJSON().count).toBe(200)
  })
})
