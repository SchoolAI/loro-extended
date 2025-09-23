/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import type { Patch } from "mutative"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPermissions } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

const tick = () => new Promise(resolve => setImmediate(resolve))

describe("Synchronizer (Host)", () => {
  let synchronizer: Synchronizer
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    synchronizer = new Synchronizer("test-peer", storage, [], {
      permissions: createPermissions(),
    })
  })

  it("should send an announce-document message when a peer is added", async () => {
    // Create a document handle first
    // const handle = synchronizer.
    await tick()

    // Add a peer - this should trigger document announcement
    synchronizer.addPeer("peer-1")
    await tick()

    // Verify the peer was added to the model
    const modelSnapshot = synchronizer.getModelSnapshot()
    expect(modelSnapshot.peers.has("peer-1")).toBe(true)

    // Verify the peer is aware of the document
    const docState = modelSnapshot.documents.get("doc-1")
    expect(docState?.peers.get("peer-1")?.isAwareOfDoc).toBe(true)
  })

  it("should handle sync request message", async () => {
    // Create a document handle first
    const handle = synchronizer.getOrCreateHandle("doc-1")

    // Add some content to the document
    handle.change(doc => {
      const root = doc.getMap("root")
      root.set("test", "value")
    })

    await tick()

    synchronizer.handleNetworkMessage({
      type: "channel/sync-request",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      docId: "doc-1",
    })

    await tick()

    // The message should be processed (no error thrown)
    // In the current implementation, sync-request handling is commented out
    // so this test mainly verifies the message is processed without error
  })

  it("should handle directory response message", async () => {
    synchronizer.handleNetworkMessage({
      type: "channel/directory-response",
      senderId: "peer-2",
      targetIds: ["test-peer"],
      docIds: ["doc-1", "doc-2"],
    })

    await tick()

    // The message should be processed (no error thrown)
    // This tests that the message handling works with the new structure
  })
})

describe("Synchronizer with Debugging", () => {
  it("should generate patches when debugging is enabled", async () => {
    const patches: Patch[] = []
    const onPatch = vi.fn((newPatches: Patch[]) => {
      patches.push(...newPatches)
    })

    const storage = new InMemoryStorageAdapter()
    const synchronizer = new Synchronizer("test-peer", storage, [], {
      onPatch,
    })

    // Add a peer - should generate patches
    synchronizer.addPeer("peer-1")
    await tick()

    expect(onPatch).toHaveBeenCalled()
    expect(patches.length).toBeGreaterThan(0)

    // Check that patches contain peer addition
    const peerPatch = patches.find(p => p.path[0] === "peers")
    expect(peerPatch).toBeDefined()
  })
})
