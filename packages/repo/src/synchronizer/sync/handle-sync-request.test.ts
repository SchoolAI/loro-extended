import type { PeerID } from "loro-crdt"
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
  expectCommand,
} from "../test-utils.js"

describe("handle-sync-request", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      rules: createRules(),
    })
  })

  it("should respond with sync data when document exists", () => {
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
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
            },
          ],
          bidirectional: true,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // The sync-request should return a send-sync-response command directly, not batched
    // But now with bidirectional sync, it might be batched if we also send a reciprocal sync-request
    // Since we have the doc, we expect:
    // 1. send-sync-response (for the requested doc)
    // 2. send-message (reciprocal sync-request)

    // The update function returns a single command or a batch command
    if (command && command.type === "cmd/batch") {
      const syncResponse = command.commands.find(
        c => c.type === "cmd/send-sync-response",
      )
      const reciprocalRequest = command.commands.find(
        c => c.type === "cmd/send-message",
      )

      expect(syncResponse).toBeDefined()
      if (syncResponse && syncResponse.type === "cmd/send-sync-response") {
        expect(syncResponse.docId).toBe(docId)
      }

      expect(reciprocalRequest).toBeDefined()
      if (reciprocalRequest && reciprocalRequest.type === "cmd/send-message") {
        expect(reciprocalRequest.envelope.message.type).toBe(
          "channel/sync-request",
        )
        expect((reciprocalRequest.envelope.message as any).bidirectional).toBe(
          false,
        )
      }
    } else {
      // If it's not a batch, it must be just the sync response (if bidirectional was false or failed)
      // But here we expect bidirectional behavior by default
      expectCommand(command, "cmd/send-sync-response")
      // This path would mean reciprocal sync failed or wasn't triggered
    }
  })

  it("should send reciprocal sync-request when bidirectional=true", () => {
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
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
            },
          ],
          bidirectional: true,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expectCommand(command, "cmd/batch")
    if (command && command.type === "cmd/batch") {
      const reciprocalRequest = command.commands.find(
        c =>
          c.type === "cmd/send-message" &&
          c.envelope.message.type === "channel/sync-request",
      )
      expect(reciprocalRequest).toBeDefined()
      if (reciprocalRequest && reciprocalRequest.type === "cmd/send-message") {
        expect((reciprocalRequest.envelope.message as any).bidirectional).toBe(
          false,
        )
        expect((reciprocalRequest.envelope.message as any).docs[0].docId).toBe(
          docId,
        )
      }
    }
  })

  it("should NOT send reciprocal when bidirectional=false", () => {
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
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
            },
          ],
          bidirectional: false,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // With no ephemeral data in the request, we just get a sync-response
    // (ephemeral is now embedded in sync-response via includeEphemeral flag)
    expectCommand(command, "cmd/send-sync-response")

    if (command && command.type === "cmd/send-sync-response") {
      expect(command.docId).toBe(docId)
      expect(command.includeEphemeral).toBe(true)
    }
  })

  it("should reject from non-established channel", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-request",
          docs: [
            {
              docId: "nonexistent-doc",
              requesterDocVersion: createVersionVector(),
            },
          ],
          bidirectional: false,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })

  it("should apply incoming ephemeral data from sync-request", () => {
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

    // Create ephemeral data (new format: EphemeralPeerData)
    const ephemeralData = new Uint8Array([1, 2, 3, 4, 5])

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
              ephemeral: {
                peerId,
                data: ephemeralData,
              },
            },
          ],
          bidirectional: false,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should be a batch containing apply-ephemeral and send-sync-response
    expectCommand(command, "cmd/batch")

    if (command && command.type === "cmd/batch") {
      const applyEphemeral = command.commands.find(
        c => c.type === "cmd/apply-ephemeral",
      )
      const syncResponse = command.commands.find(
        c => c.type === "cmd/send-sync-response",
      )

      expect(applyEphemeral).toBeDefined()
      if (applyEphemeral && applyEphemeral.type === "cmd/apply-ephemeral") {
        // New format: stores array
        expect(applyEphemeral.stores).toHaveLength(1)
        expect(applyEphemeral.docId).toBe(docId)
        expect(applyEphemeral.stores[0].peerId).toBe(peerId)
        expect(Array.from(applyEphemeral.stores[0].data)).toEqual(
          Array.from(ephemeralData),
        )
      }

      expect(syncResponse).toBeDefined()
      if (syncResponse && syncResponse.type === "cmd/send-sync-response") {
        expect(syncResponse.docId).toBe(docId)
        expect(syncResponse.includeEphemeral).toBe(true)
      }
    }
  })

  it("should relay ephemeral to other peers when received in sync-request", () => {
    const peerId1 = "peer-1" as PeerID
    const peerId2 = "peer-2" as PeerID
    const channel1 = createEstablishedChannel(peerId1, { channelId: 1 })
    const channel2 = createEstablishedChannel(peerId2, { channelId: 2 })
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel1)

    // Add second channel (with different channelId)
    initialModel.channels.set(channel2.channelId, channel2)

    // Add peer states - both subscribed to the doc
    initialModel.peers.set(peerId1, {
      identity: { peerId: peerId1, name: "peer-1", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set([docId]),
      lastSeen: new Date(),
      channels: new Set([channel1.channelId]),
    })
    initialModel.peers.set(peerId2, {
      identity: { peerId: peerId2, name: "peer-2", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set([docId]),
      lastSeen: new Date(),
      channels: new Set([channel2.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    // Create ephemeral data (new format: EphemeralPeerData)
    const ephemeralData = new Uint8Array([1, 2, 3, 4, 5])

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel1.channelId,
        message: {
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
              ephemeral: {
                peerId: peerId1,
                data: ephemeralData,
              },
            },
          ],
          bidirectional: false,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should be a batch containing apply-ephemeral, relay message, and send-sync-response
    expectCommand(command, "cmd/batch")

    if (command && command.type === "cmd/batch") {
      // Find the relay message (send-message with channel/ephemeral)
      const relayMessage = command.commands.find(
        c =>
          c.type === "cmd/send-message" &&
          c.envelope.message.type === "channel/ephemeral",
      )

      expect(relayMessage).toBeDefined()
      if (relayMessage && relayMessage.type === "cmd/send-message") {
        // Should relay to peer2, not back to peer1
        expect(relayMessage.envelope.toChannelIds).not.toContain(
          channel1.channelId,
        )
        expect(relayMessage.envelope.toChannelIds).toContain(channel2.channelId)

        if (relayMessage.envelope.message.type === "channel/ephemeral") {
          expect(relayMessage.envelope.message.docId).toBe(docId)
          expect(relayMessage.envelope.message.hopsRemaining).toBe(0)
          // New format: stores array
          expect(relayMessage.envelope.message.stores).toHaveLength(1)
          expect(relayMessage.envelope.message.stores[0].peerId).toBe(peerId1)
        }
      }
    }
  })

  it("should include ephemeral in sync-response via includeEphemeral flag", () => {
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
          type: "channel/sync-request",
          docs: [
            {
              docId,
              requesterDocVersion: createVersionVector(),
              // No ephemeral in request
            },
          ],
          bidirectional: false,
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should return send-sync-response with includeEphemeral=true
    expectCommand(command, "cmd/send-sync-response")

    if (command && command.type === "cmd/send-sync-response") {
      expect(command.docId).toBe(docId)
      expect(command.includeEphemeral).toBe(true)
    }
  })
})
