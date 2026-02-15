import { change, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"
import { InMemoryStorageAdapter } from "./in-memory-storage-adapter.js"

const DocSchema = Shape.doc({ content: Shape.text() })

describe("Repo.shutdown() flushes pending storage saves", () => {
  it("should persist data across repo instances when using shutdown()", async () => {
    // Shared storage backing (simulates persistent storage like filesystem)
    const sharedData = new Map<string, Uint8Array>()

    // Session 1: create a document, mutate it, then shutdown gracefully
    const storage1 = new InMemoryStorageAdapter({ sharedData })
    const repo1 = new Repo({
      adapters: [storage1],
      identity: { name: "test", type: "user" },
    })

    const doc1 = repo1.get("doc", DocSchema)
    change(doc1, draft => {
      draft.content.insert(0, "Hello, world!")
    })
    expect(doc1.content.toString()).toBe("Hello, world!")

    // Graceful shutdown - should await pending storage saves
    await repo1.shutdown()

    // Verify data was actually saved to storage
    expect(sharedData.size).toBeGreaterThan(0)

    // Session 2: load from the same storage
    const storage2 = new InMemoryStorageAdapter({ sharedData })
    const repo2 = new Repo({
      adapters: [storage2],
      identity: { name: "test", type: "user" },
    })

    const doc2 = repo2.get("doc", DocSchema)
    await sync(doc2).waitForSync({ kind: "storage", timeout: 5000 })

    expect(doc2.content.toString()).toBe("Hello, world!")

    await repo2.shutdown()
  })

  it("flush() should await pending storage operations without disconnecting", async () => {
    const sharedData = new Map<string, Uint8Array>()

    const storage = new InMemoryStorageAdapter({ sharedData })
    const repo = new Repo({
      adapters: [storage],
      identity: { name: "test", type: "user" },
    })

    const doc = repo.get("doc", DocSchema)
    change(doc, draft => {
      draft.content.insert(0, "Hello!")
    })

    // Flush should await pending saves without disconnecting
    await repo.flush()

    // Verify data was saved
    expect(sharedData.size).toBeGreaterThan(0)

    // Repo should still be usable after flush
    change(doc, draft => {
      draft.content.insert(6, " World!")
    })

    await repo.flush()

    // Clean up
    await repo.shutdown()
  })
})
