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
    const { status } = await handle.whenReady()
    expect(status).toBe("ready")
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

    // Set up the expectation that whenReady() will resolve with "unavailable".
    const readyPromise = handle.whenReady()

    // Advance the timers by the discovery timeout to trigger the state change
    await vi.advanceTimersByTimeAsync(5000)

    // Wait for the resolution and confirm the status
    const { status } = await readyPromise
    expect(status).toBe("unavailable")

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
    const { status: statusA } = await handleA.whenReady()
    expect(statusA).toBe("ready")

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
    const { status: statusB } = await handleB.whenReady()
    expect(statusB).toBe("ready")

    expect(handleB.state).toBe("ready")
    expect(handleB.doc().toJSON()).toEqual({ root: { text: "hello" } })
  })

  it("should delete a document", async () => {
    const handle = repo.create()
    await vi.runAllTimersAsync()
    const { status } = await handle.whenReady()
    expect(status).toBe("ready")
    repo.delete(handle.documentId)

    expect(handle.state).toBe("deleted")

    // The handle should be removed from the cache, so find creates a new one
    const foundHandle = repo.find(handle.documentId)
    expect(foundHandle).not.toBe(handle)

    // The new handle for a deleted doc should be unavailable because it's gone from storage
    expect(foundHandle.state).toBe("loading")
    // The handle will try to load from storage, which will fail
    await vi.advanceTimersByTimeAsync(0)
    expect(foundHandle.state).toBe("searching")

    // Set up the whenReady promise
    const readyPromise = foundHandle.whenReady()

    // The synchronizer will now time out waiting for a peer
    await vi.advanceTimersByTimeAsync(5000)

    const { status: foundStatus } = await readyPromise
    expect(foundStatus).toBe("unavailable")
    expect(foundHandle.state).toBe("unavailable")
  })
})

describe("CollectionSynchronizer with permissions", () => {
  let repo: Repo
  let synchronizer: any // Access private methods for testing
  let mockPermissions: any
  let messageSpy: any

  beforeEach(() => {
    vi.useFakeTimers()
    mockPermissions = {
      canRevealDocumentId: vi.fn(() => true),
      canWrite: vi.fn(() => true),
      canDelete: vi.fn(() => true),
    }

    repo = new Repo({
      permissions: mockPermissions,
      peerId: "test-peer",
    })

    synchronizer = repo.synchronizer
    messageSpy = vi.spyOn(synchronizer, "emit")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should not send an announce-document message if canRevealDocumentId is false", async () => {
    mockPermissions.canRevealDocumentId.mockResolvedValue(false)
    const handle = repo.create()
    repo.handles.set(handle.documentId, handle)
    handle._setState("ready")
    await synchronizer.addPeer("peer-2")

    expect(mockPermissions.canRevealDocumentId).toHaveBeenCalledWith(
      "peer-2",
      handle.documentId,
    )
    expect(messageSpy).not.toHaveBeenCalled()
  })

  it("should not send a sync message if canWrite is false", async () => {
    mockPermissions.canWrite.mockResolvedValue(false)
    const handle = repo.create()
    await handle.whenReady() // Let the handle become ready naturally

    // Add the peer after the handle is ready
    await synchronizer.addPeer("peer-2")

    // The 'sync-message' event on the handle is the correct way to get the sync data
    handle.on("sync-message", () => {
      // This part of the test is tricky; we need to verify a message *isn't* sent.
      // The spy check below is the actual verification.
    })

    handle.change(d => {
      d.text = "hello"
    })

    await vi.runAllTimersAsync() // Allow async operations to complete

    expect(mockPermissions.canWrite).toHaveBeenCalledWith(
      "peer-2",
      handle.documentId,
    )

    // Check that no 'sync' message was emitted
    const syncCalls = messageSpy.mock.calls.filter(
      (call: any[]) => call[0] === "message" && call[1].type === "sync",
    )
    expect(syncCalls.length).toBe(0)
  })

  it("should not delete a document if canDelete returns false", async () => {
    mockPermissions.canDelete.mockResolvedValue(false)
    const deleteSpy = vi.spyOn(repo, "delete")
    await synchronizer.receiveMessage({
      type: "delete-document",
      senderId: "peer-2",
      documentId: "doc-to-delete",
    })
    expect(mockPermissions.canDelete).toHaveBeenCalledWith(
      "peer-2",
      "doc-to-delete",
    )
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it("should not announce a new document when canRevealDocumentId is false", async () => {
    mockPermissions.canRevealDocumentId.mockResolvedValue(false)
    await synchronizer.addPeer("peer-2") // Peer is known beforehand
    messageSpy.mockClear() // Clear spy from connection setup

    const handle = repo.create()
    await vi.runAllTimersAsync() // This makes the handle ready and triggers addDocument's .then()

    expect(mockPermissions.canRevealDocumentId).toHaveBeenCalledWith(
      "peer-2",
      handle.documentId,
    )
    // Check that no 'announce-document' message was emitted
    const announceCalls = messageSpy.mock.calls.filter(
      (call: any[]) =>
        call[0] === "message" && call[1].type === "announce-document",
    )
    expect(announceCalls.length).toBe(0)
  })
})