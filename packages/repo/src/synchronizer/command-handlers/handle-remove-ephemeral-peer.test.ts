import type { EphemeralStore, PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"
import {
  createEstablishedChannel,
  createMockCommandContext,
  createMockEphemeralStore,
} from "../test-utils.js"
import { handleRemoveEphemeralPeer } from "./handle-remove-ephemeral-peer.js"

type RemoveEphemeralPeerCommand = Extract<
  Command,
  { type: "cmd/remove-ephemeral-peer" }
>

describe("handleRemoveEphemeralPeer", () => {
  it("should remove peer data from all documents' namespaced stores", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
      "other-peer": { cursor: { x: 30, y: 40 } },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    expect(mockStore.delete).toHaveBeenCalledWith("peer-to-remove")
  })

  it("should broadcast deletion to other peers", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    // Set up established channel and peer
    const peerId = "other-peer" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 42 })

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    // Add channel and peer to model
    ctx.model.channels.set(channel.channelId, channel)
    ctx.model.peers.set(peerId, {
      identity: { peerId, name: "other", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(["doc-1"]),
      channels: new Set([channel.channelId]),
    })

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    // Should queue deletion message
    expect(ctx.queueSend).toHaveBeenCalled()

    const call = (ctx.queueSend as any).mock.calls[0]
    expect(call[0]).toBe(42) // channelId
    expect(call[1].type).toBe("channel/ephemeral")
    expect(call[1].docId).toBe("doc-1")
    expect(call[1].stores[0].peerId).toBe("peer-to-remove")
    expect(call[1].stores[0].data).toEqual(new Uint8Array(0)) // Empty = deletion
    expect(call[1].stores[0].namespace).toBe("presence")
  })

  it("should emit ephemeral-change event for each affected document", async () => {
    const mockStore = createMockEphemeralStore()
    mockStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    expect(emitSpy).toHaveBeenCalledWith("ephemeral-change", {
      docId: "doc-1",
      source: "remote",
      peerId: "peer-to-remove",
    })
  })

  it("should handle multiple documents with peer data", () => {
    const mockStore1 = createMockEphemeralStore()
    mockStore1.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
    }))

    const mockStore2 = createMockEphemeralStore()
    mockStore2.getAllStates = vi.fn(() => ({
      "peer-to-remove": { name: "Alice" },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()

    const namespaceMap1 = new Map<string, EphemeralStore>()
    namespaceMap1.set("presence", mockStore1 as any)
    docNamespacedStores.set("doc-1", namespaceMap1)

    const namespaceMap2 = new Map<string, EphemeralStore>()
    namespaceMap2.set("presence", mockStore2 as any)
    docNamespacedStores.set("doc-2", namespaceMap2)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    // Should delete from both stores
    expect(mockStore1.delete).toHaveBeenCalledWith("peer-to-remove")
    expect(mockStore2.delete).toHaveBeenCalledWith("peer-to-remove")

    // Should emit for both documents
    expect(emitSpy).toHaveBeenCalledTimes(2)
  })

  it("should skip documents where peer has no data", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.getAllStates = vi.fn(() => ({
      "other-peer": { cursor: { x: 10, y: 20 } },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    // Should not delete (peer not in store)
    expect(mockStore.delete).not.toHaveBeenCalled()
    // Should not emit
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it("should handle multiple namespaces for same document", () => {
    const mockPresenceStore = createMockEphemeralStore()
    mockPresenceStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
    }))

    const mockCursorsStore = createMockEphemeralStore()
    mockCursorsStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { position: 42 },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockPresenceStore as any)
    namespaceMap.set("cursors", mockCursorsStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    // Set up established channel and peer
    const peerId = "other-peer" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 42 })

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    ctx.model.channels.set(channel.channelId, channel)
    ctx.model.peers.set(peerId, {
      identity: { peerId, name: "other", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(["doc-1"]),
      channels: new Set([channel.channelId]),
    })

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    // Should delete from both stores
    expect(mockPresenceStore.delete).toHaveBeenCalledWith("peer-to-remove")
    expect(mockCursorsStore.delete).toHaveBeenCalledWith("peer-to-remove")

    // Should broadcast deletion for both namespaces
    expect(ctx.queueSend).toHaveBeenCalled()
    const call = (ctx.queueSend as any).mock.calls[0]
    expect(call[1].stores).toHaveLength(2)
  })

  it("should not broadcast if no channels for document", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.getAllStates = vi.fn(() => ({
      "peer-to-remove": { cursor: { x: 10, y: 20 } },
    }))

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })
    // No channels or peers set up

    const command: RemoveEphemeralPeerCommand = {
      type: "cmd/remove-ephemeral-peer",
      peerId: "peer-to-remove" as PeerID,
    }

    handleRemoveEphemeralPeer(command, ctx)

    // Should still delete locally
    expect(mockStore.delete).toHaveBeenCalledWith("peer-to-remove")
    // But should not broadcast (no channels)
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })
})
