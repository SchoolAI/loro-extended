import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DocHandle } from "./doc-handle.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./network/in-process-network-adapter.js"

describe("Repo", () => {
  type DocSchema = { text: string }
  let repo: Repo

  beforeEach(() => {
    vi.useFakeTimers()
    repo = new Repo({
      storage: new InMemoryStorageAdapter(),
      network: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should create a new document and return a handle", async () => {
    const handle = repo.create()
    expect(handle).toBeInstanceOf(DocHandle)
    await vi.runAllTimersAsync()
    await handle.whenReady()
    expect(handle.state).toBe("ready")
  })

  it("should find an existing document handle", async () => {
    const handle = repo.create()
    await vi.runAllTimersAsync()
    const foundHandle = repo.find(handle.documentId)
    expect(foundHandle).toBe(handle)
  })

  it("should time out if a document is not found in storage or on the network", async () => {
    const handle = repo.find("non-existent-doc")
    expect(handle.state).toBe("loading")

    // The handle should transition to "searching" after failing to find the doc in storage.
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.state).toBe("searching")

    // Set up the expectation that whenReady() will reject *before* triggering the timeout.
    const rejectionPromise = expect(handle.whenReady()).rejects.toThrow(
      "Document entered state: unavailable",
    )

    // Advance the timers by the discovery timeout to trigger the state change and rejection
    await vi.advanceTimersByTimeAsync(5000)

    // Wait for the rejection assertion to complete
    await rejectionPromise

    // Finally, confirm the handle's state
    expect(handle.state).toBe("unavailable")
  })

  it("should find a document from a peer", async () => {
    const broker = new InProcessNetworkBroker()

    // Repo A creates a document
    const repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      peerId: "repoA",
    })
    const handleA = repoA.create<DocSchema>()
    await vi.runAllTimersAsync()
    await handleA.whenReady()

    // Mutate the document in Repo A
    handleA.change(doc => {
      doc.text = "hello"
    })

    // Repo B looks for the document
    const repoB = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      peerId: "repoB",
    })
    const handleB = repoB.find<DocSchema>(handleA.documentId)

    await vi.runAllTimersAsync()
    await handleB.whenReady()

    expect(handleB.state).toBe("ready")
    expect(handleB.doc().toJSON()).toEqual({ root: { text: "hello" } })
  })

  it("should delete a document", async () => {
    const handle = repo.create()
    await vi.runAllTimersAsync()
    await handle.whenReady()
    repo.delete(handle.documentId)

    expect(handle.state).toBe("deleted")

    // The handle should be removed from the cache, so find creates a new one
    // const foundHandle = repo.find(handle.documentId)
    // expect(foundHandle).not.toBe(handle)

    // // The new handle for a deleted doc should be unavailable because it's gone from storage
    // expect(foundHandle.state).toBe("loading")
    // await foundHandle.whenReady().catch(() => {})
    // expect(foundHandle.state).toBe("unavailable")
  })
})