import { beforeEach, describe, expect, it } from "vitest"
import { DocHandle } from "./doc-handle.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

describe("Repo", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      storage: new InMemoryStorageAdapter(),
      network: [],
    })
  })

  it("should create a new document and return a handle", async () => {
    const handle = repo.create()
    expect(handle).toBeInstanceOf(DocHandle)
    await handle.whenReady()
    expect(handle.state).toBe("ready")
  })

  it("should find an existing document handle", async () => {
    const handle = await repo.create()
    const foundHandle = await repo.find(handle.documentId)
    expect(foundHandle).toBe(handle)
  })

  it("should create a new handle for a documentId that is not in the cache", async () => {
    const docId = "non-existent-doc"
    const handle = repo.find(docId)
    expect(handle).toBeInstanceOf(DocHandle)
    expect(handle.documentId).toBe(docId)

    // Since there's no network, it should eventually become unavailable
    await handle.whenReady().catch(() => {}) // Catch expected rejection
    expect(handle.state).toBe("unavailable")
  })

  it("should delete a document", async () => {
    const handle = repo.create()
    await handle.whenReady()
    repo.delete(handle.documentId)

    expect(handle.state).toBe("deleted")

    // The handle should be removed from the cache, so find creates a new one
    const foundHandle = repo.find(handle.documentId)
    expect(foundHandle).not.toBe(handle)
    
    // The new handle for a deleted doc should be unavailable because it's gone from storage
    expect(foundHandle.state).toBe("loading")
    await foundHandle.whenReady().catch(() => {})
    expect(foundHandle.state).toBe("unavailable")
  })
})