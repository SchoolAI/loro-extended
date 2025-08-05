import { beforeEach, describe, expect, it, vi } from "vitest"

import { createPermissions } from "src/auth/permission-adapter.js"
import {
  Synchronizer,
  type SynchronizerServices,
} from "./synchronizer.js"

const tick = () => new Promise(resolve => setImmediate(resolve))

describe("Synchronizer (Host)", () => {
  let synchronizer: Synchronizer
  let mockServices: SynchronizerServices

  beforeEach(() => {
    mockServices = {
      sendMessage: vi.fn(),
      getDoc: vi.fn(),
      permissions: createPermissions(),
    }
    synchronizer = new Synchronizer(mockServices)
  })

  it("should send an announce-document message when a peer is added", async () => {
    const mockHandle = { documentId: "doc-1" }
    synchronizer.addDocument(mockHandle.documentId)
    await tick()

    synchronizer.addPeer("peer-1")
    await tick()

    expect(mockServices.sendMessage).toHaveBeenCalledWith({
      type: "announce-document",
      targetIds: ["peer-1"],
      documentIds: ["doc-1"],
    })
  })

  // it("should send a request-sync message when beginSync is called", async () => {
  //   synchronizer.beginSync("doc-1")
  //   await tick()

  //   expect(mockServices.sendMessage).toHaveBeenCalledWith({
  //     type: "request-sync",
  //     targetIds: [],
  //     documentId: "doc-1",
  //   })
  // })

  it("should execute a load-and-send-sync command", async () => {
    const mockHandle = {
      state: "ready",
      doc: () => ({
        exportSnapshot: () => new Uint8Array([1, 2, 3]),
      }),
    }

    ;(mockServices.getDoc as any).mockReturnValue(mockHandle)

    synchronizer.addDocument("doc-1")
    await tick()

    synchronizer.handleRepoMessage({
      type: "request-sync",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      documentId: "doc-1",
    })

    await tick()

    expect(mockServices.getDoc).toHaveBeenCalledWith("doc-1")
    expect(mockServices.sendMessage).toHaveBeenCalledWith({
      type: "sync",
      targetIds: ["peer-2"],
      documentId: "doc-1",
      data: new Uint8Array([1, 2, 3]),
    })
  })

  it("should apply a sync message on sync_succeeded", async () => {
    const mockHandle = {
      applySyncMessage: vi.fn(),
      doc: () => "the-doc",
    }

    ;(mockServices.getDoc as any).mockReturnValue(mockHandle)

    const promise = synchronizer.queryNetwork("doc-1")
    await tick()

    synchronizer.handleRepoMessage({
      type: "sync",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      documentId: "doc-1",
      data: new Uint8Array([4, 5, 6]),
    })
    await tick()

    const result = await promise
    expect(result).toBe("the-doc")

    expect(mockServices.getDoc).toHaveBeenCalledWith("doc-1")
    expect(mockHandle.applySyncMessage).toHaveBeenCalledWith(
      new Uint8Array([4, 5, 6]),
    )
  })

  it("should resolve with null if the sync fails", async () => {
    vi.useFakeTimers()

    const promise = synchronizer.queryNetwork("doc-1")

    // Process the initial dispatch
    await Promise.resolve()

    // MAX_RETRIES is 3, so we have:
    // Initial attempt (5000ms) + 3 retries with exponential backoff
    // Retry 1: 10000ms (5000 * 2^1)
    // Retry 2: 20000ms (5000 * 2^2)
    // Retry 3: 40000ms (5000 * 2^3)
    // After the 4th timeout, it should fail

    // Initial timeout: 5000ms
    await vi.advanceTimersByTimeAsync(5000)

    // First retry: 10000ms
    await vi.advanceTimersByTimeAsync(10000)

    // Second retry: 20000ms
    await vi.advanceTimersByTimeAsync(20000)

    // Third retry: 40000ms
    await vi.advanceTimersByTimeAsync(40000)

    const result = await promise
    expect(result).toBeNull()

    vi.useRealTimers()
  }, 10000) // Increase test timeout to 10 seconds
})
