import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../../permissions.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import { createDocState, createEstablishedChannel } from "../test-utils.js"

describe("handle-doc-unload", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should remove the document from the model", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })

    const docState = createDocState({ docId: "test-doc" })
    initialModel.documents.set("test-doc", docState)
    expect(initialModel.documents.has("test-doc")).toBe(true)

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-unload",
      docId: "test-doc",
    }

    const [newModel, command] = update(message, initialModel)

    expect(newModel.documents.has("test-doc")).toBe(false)
    expect(command).toBeUndefined()
  })

  it("should NOT send a delete-request even when a peer is subscribed", () => {
    // This is the load-bearing difference from doc-delete: doc-delete fans out a
    // channel/delete-request to every subscribed peer; doc-unload must send
    // nothing (storage and peers are untouched — it is a memory eviction).
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const docId = "test-doc"

    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })
    initialModel.channels.set(channel.channelId, channel)

    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    // Peer is subscribed to the doc — doc-delete would notify it.
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set([docId]),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-unload",
      docId,
    }

    const [newModel, command] = update(message, initialModel)

    expect(newModel.documents.has(docId)).toBe(false)
    expect(command).toBeUndefined()
  })

  it("should leave peer subscriptions intact (stale-but-harmless)", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const docId = "test-doc"

    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })
    initialModel.channels.set(channel.channelId, channel)

    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set([docId]),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-unload",
      docId,
    }

    const [newModel] = update(message, initialModel)

    // Subscription is intentionally NOT pruned: a later re-get re-establishes it.
    expect(newModel.peers.get(peerId)?.subscriptions.has(docId)).toBe(true)
  })

  it("should log a warning when the document doesn't exist (idempotent)", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-unload",
      docId: "nonexistent-doc",
    }

    const [newModel, command] = update(message, initialModel)

    expect(newModel).toBe(initialModel)
    expect(command).toBeUndefined()
  })
})
