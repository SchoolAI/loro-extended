import { LoroDoc, type PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createRules } from "../../rules.js"
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
      rules: createRules(),
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

    const [newModel, command] = update(message, initialModel)

    // Document should exist (not imported yet - that happens via command)
    const updatedDocState = newModel.documents.get(docId)
    expect(updatedDocState?.doc).toBeDefined()

    // Peer awareness is NOT updated in the handler for snapshot/update
    // It's updated after import via cmd/import-doc-data -> synchronizer/doc-imported
    // This is intentional to prevent echo loops
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)
    expect(awareness).toBeUndefined()

    // Should return cmd/import-doc-data (no longer batched with broadcast-ephemeral)
    // Ephemeral is now embedded in sync-response, not broadcast separately
    expect(command).toBeDefined()
    expect(command?.type).toBe("cmd/import-doc-data")

    if (command?.type === "cmd/import-doc-data") {
      expect(command.docId).toBe(docId)
      expect(command.fromPeerId).toBe(peerId)
    }
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
  it("should defer peer awareness update to after import (via cmd/import-doc-data)", () => {
    // This test verifies the new architecture that prevents echo loops:
    // 1. handle-sync-response does NOT update peer awareness for snapshot/update
    // 2. It returns cmd/import-doc-data with fromPeerId
    // 3. After import, synchronizer/doc-imported updates peer awareness to CURRENT version
    //
    // This prevents echoes because peer awareness is set to our merged version
    // (which includes both local and imported changes), not just the peer's sent version.

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

    const [newModel, command] = update(message, initialModel)

    // Peer awareness should NOT be updated in the handler
    // It will be updated after import via synchronizer/doc-imported
    const peerState = newModel.peers.get(peerId)
    const awareness = peerState?.documentAwareness.get(docId)
    expect(awareness).toBeUndefined()

    // Should return cmd/import-doc-data (no longer batched with broadcast-ephemeral)
    // Ephemeral is now embedded in sync-response, not broadcast separately
    expect(command).toBeDefined()
    expect(command?.type).toBe("cmd/import-doc-data")

    if (command?.type === "cmd/import-doc-data") {
      expect(command.docId).toBe(docId)
      expect(command.fromPeerId).toBe(peerId)
      expect(command.data).toEqual(snapshotData)
    }

    // Document should NOT have imported data yet (import happens via command)
    const updatedDocState = newModel.documents.get(docId)
    // The doc still has only local changes
    expect(updatedDocState?.doc.getText("text").toString()).toBe("local")
  })

  it("should apply ephemeral data from sync-response", () => {
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

    // Create valid snapshot data
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("test").insert(0, "hello")
    const snapshotData = sourceDoc.export({ mode: "snapshot" })

    // Create ephemeral data (new format: EphemeralStoreData[])
    const ephemeralData = new Uint8Array([10, 20, 30, 40, 50])

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
          ephemeral: [
            {
              peerId,
              data: ephemeralData,
              namespace: "presence",
            },
          ],
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should return cmd/batch containing cmd/import-doc-data and cmd/apply-ephemeral
    expect(command).toBeDefined()
    expect(command?.type).toBe("cmd/batch")

    if (command?.type === "cmd/batch") {
      const importCmd = command.commands.find(
        c => c.type === "cmd/import-doc-data",
      )
      const applyEphemeralCmd = command.commands.find(
        c => c.type === "cmd/apply-ephemeral",
      )

      expect(importCmd).toBeDefined()
      expect(applyEphemeralCmd).toBeDefined()

      if (applyEphemeralCmd?.type === "cmd/apply-ephemeral") {
        // New format: stores array
        expect(applyEphemeralCmd.stores).toHaveLength(1)
        expect(applyEphemeralCmd.docId).toBe(docId)
        expect(applyEphemeralCmd.stores[0].peerId).toBe(peerId)
        expect(Array.from(applyEphemeralCmd.stores[0].data)).toEqual(
          Array.from(ephemeralData),
        )
      }
    }
  })

  it("should not include apply-ephemeral when no ephemeral in sync-response", () => {
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

    // Create valid snapshot data
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
          // No ephemeral field
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should return just cmd/import-doc-data (no batch needed)
    expect(command).toBeDefined()
    expect(command?.type).toBe("cmd/import-doc-data")
  })
})
