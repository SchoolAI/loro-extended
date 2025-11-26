import { LoroDoc, type PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import {
  createEstablishedChannel,
  createMockChannel,
  createModelWithChannel,
  createVersionVector,
} from "../test-utils.js"

describe("handle-sync-response", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should handle up-to-date response", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "up-to-date",
            version: createVersionVector(),
          },
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Should update peer awareness
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)
    expect(awareness?.awareness).toBe("has-doc")
    expect(awareness?.lastKnownVersion).toBeDefined()
  })

  it("should handle snapshot response", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    // Create valid snapshot data by exporting from a LoroDoc
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("test").insert(0, "hello")
    const snapshotData = sourceDoc.export({ mode: "snapshot" })
    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "snapshot",
            data: snapshotData,
            version: createVersionVector(),
          },
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Document should have imported the data
    const updatedDocState = newModel.documents.get(docId)
    expect(updatedDocState?.doc).toBeDefined()

    // Should update peer awareness
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)
    expect(awareness?.awareness).toBe("has-doc")
  })

  it("should handle unavailable response", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "unavailable",
          },
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Should update peer awareness to no-doc
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)
    expect(awareness?.awareness).toBe("no-doc")
  })

  it("should reject from non-established channel (no doc)", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId: "nonexistent-doc",
          transmission: { type: "unavailable" },
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })

  it("should reject from non-established channel (with doc)", () => {
    const channel = createMockChannel()
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add document but no channel state
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId,
          transmission: { type: "unavailable" },
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })
  it("should update peer awareness with peer's version, not local merged version", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document with local changes
    const docState = createDocState({ docId })
    docState.doc.getText("text").insert(0, "local")
    initialModel.documents.set(docId, docState)

    // Create peer document with different changes
    const peerDoc = new LoroDoc()
    peerDoc.getText("text").insert(0, "peer")
    const peerVersion = peerDoc.version()
    const snapshotData = peerDoc.export({ mode: "snapshot" })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-response",
          docId,
          transmission: {
            type: "snapshot",
            data: snapshotData,
            version: peerVersion,
          },
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Should update peer awareness
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)

    // The peer's last known version should be what they sent us (peerVersion)
    // It should NOT be the merged version (which would include "local" + "peer")
    expect(awareness?.lastKnownVersion?.toJSON()).toEqual(peerVersion.toJSON())

    // Verify that local doc has merged changes
    const updatedDocState = newModel.documents.get(docId)
    const mergedVersion = updatedDocState?.doc.version()

    // Merged version should be different from peer version (because we had local changes)
    expect(mergedVersion?.toJSON()).not.toEqual(peerVersion.toJSON())
  })
})
