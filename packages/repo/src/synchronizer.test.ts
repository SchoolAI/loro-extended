/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import type { Patch } from "mutative"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DebugModel } from "./debug-model.js"
import { createPermissions } from "./permission-adapter.js"
import { Synchronizer, type SynchronizerServices } from "./synchronizer.js"

const tick = () => new Promise(resolve => setImmediate(resolve))

describe("Synchronizer (Host)", () => {
  let synchronizer: Synchronizer
  let mockServices: SynchronizerServices

  beforeEach(() => {
    mockServices = {
      send: vi.fn(),
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

    expect(mockServices.send).toHaveBeenCalledWith({
      type: "directory-response",
      targetIds: ["peer-1"],
      documentIds: ["doc-1"],
    })
  })

  it("should execute a load-and-send-sync command", async () => {
    const mockHandle = {
      fullState: "ready",
      doc: () => ({ export: () => new Uint8Array([1, 2, 3]) }),
    }

    ;(mockServices.getDoc as any).mockReturnValue(mockHandle)

    synchronizer.addDocument("doc-1")
    await tick()

    synchronizer.handleRepoMessage({
      type: "sync-request",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      documentId: "doc-1",
    })

    await tick()

    expect(mockServices.getDoc).toHaveBeenCalledWith("doc-1")
    expect(mockServices.send).toHaveBeenCalledWith({
      type: "sync-response",
      targetIds: ["peer-2"],
      documentId: "doc-1",
      transmission: { type: "update", data: new Uint8Array([1, 2, 3]) },
      hopCount: 0, // Original message from this peer
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
      type: "sync-response",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      documentId: "doc-1",
      transmission: { type: "update", data: new Uint8Array([4, 5, 6]) },
      hopCount: 0, // Original message from peer-2
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

describe("Synchronizer with Debugging", () => {
  let mockServices: SynchronizerServices

  beforeEach(() => {
    mockServices = {
      send: vi.fn(),
      getDoc: vi.fn(),
      permissions: createPermissions(),
    }
  })

  it("should generate patches when debugging is enabled", async () => {
    const patches: Patch[] = []
    const onPatch = vi.fn((newPatches: Patch[]) => {
      patches.push(...newPatches)
    })

    const synchronizer = new Synchronizer({
      services: mockServices,
      enableDebugging: true,
      onPatch,
    })

    expect(synchronizer.isDebuggingEnabled()).toBe(true)

    // Add a peer - should generate patches
    synchronizer.addPeer("peer-1")
    await tick()

    expect(onPatch).toHaveBeenCalled()
    expect(patches.length).toBeGreaterThan(0)

    // Check that patches contain peer addition
    const peerPatch = patches.find(p => p.path[0] === "peers")
    expect(peerPatch).toBeDefined()
  })

  it("should not generate patches when debugging is disabled", async () => {
    const onPatch = vi.fn()

    const synchronizer = new Synchronizer({
      services: mockServices,
      enableDebugging: false,
      onPatch,
    })

    expect(synchronizer.isDebuggingEnabled()).toBe(false)

    synchronizer.addPeer("peer-1")
    await tick()

    expect(onPatch).not.toHaveBeenCalled()
  })

  it("should work with legacy constructor (backward compatibility)", async () => {
    const synchronizer = new Synchronizer(mockServices)

    expect(synchronizer.isDebuggingEnabled()).toBe(false)
    expect(synchronizer.getModelSnapshot()).toBeNull()

    // Should still work normally
    synchronizer.addPeer("peer-1")
    await tick()

    expect(mockServices.send).toHaveBeenCalled()
  })

  it("should apply patches correctly to debug model", async () => {
    const debugModel = new DebugModel(true)
    const patches: Patch[] = []

    const synchronizer = new Synchronizer({
      services: mockServices,
      enableDebugging: true,
      onPatch: (newPatches: Patch[]) => {
        patches.push(...newPatches)
        debugModel.applyPatches(newPatches)
      },
    })

    // Add a peer
    synchronizer.addPeer("peer-1")
    await tick()

    // Check that debug model was updated
    const peers = debugModel.getPeers()
    expect(peers["peer-1"]).toBeDefined()
    expect(peers["peer-1"].connected).toBe(true)

    // Add a document
    synchronizer.addDocument("doc-1")
    await tick()

    // Check that debug model was updated
    const localDocs = debugModel.getLocalDocs()
    expect(localDocs).toContain("doc-1")

    // Remove the peer
    synchronizer.removePeer("peer-1")
    await tick()

    // Check that peer was removed from debug model
    const updatedPeers = debugModel.getPeers()
    expect(updatedPeers["peer-1"]).toBeUndefined()
  })

  it("should provide model snapshots when debugging is enabled", async () => {
    const synchronizer = new Synchronizer({
      services: mockServices,
      enableDebugging: true,
    })

    // Add some state
    synchronizer.addPeer("peer-1")
    synchronizer.addDocument("doc-1")
    await tick()

    const snapshot = synchronizer.getModelSnapshot()
    expect(snapshot).not.toBeNull()
    expect(snapshot.peers["peer-1"]).toBeDefined()
    expect(snapshot.localDocs).toContain("doc-1")
  })

  it("should track complex state changes through patches", async () => {
    const debugModel = new DebugModel(true)
    let patchCount = 0

    const synchronizer = new Synchronizer({
      services: mockServices,
      enableDebugging: true,
      onPatch: (patches: Patch[]) => {
        patchCount += patches.length
        debugModel.applyPatches(patches)
      },
    })

    // Perform a sequence of operations
    synchronizer.addPeer("peer-1")
    await tick()

    synchronizer.addDocument("doc-1")
    await tick()

    synchronizer.addPeer("peer-2")
    await tick()

    synchronizer.removePeer("peer-1")
    await tick()

    // Should have generated multiple patches
    expect(patchCount).toBeGreaterThan(0)

    // Debug model should reflect final state
    const peers = debugModel.getPeers()
    const localDocs = debugModel.getLocalDocs()

    expect(peers["peer-1"]).toBeUndefined() // Removed
    expect(peers["peer-2"]).toBeDefined() // Still there
    expect(localDocs).toContain("doc-1")
  })
})
