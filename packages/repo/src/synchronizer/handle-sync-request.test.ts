import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import { createDocState } from "../types.js"
import {
  createEstablishedChannel,
  createMockChannel,
  createModelWithChannel,
  createVersionVector,
  expectCommand,
} from "./test-utils.js"

describe("handle-sync-request", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
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

    // Should be a batch because we always send broadcast-ephemeral now
    expectCommand(command, "cmd/batch")

    if (command && command.type === "cmd/batch") {
      // Should contain sync-response and broadcast-ephemeral
      const syncResponse = command.commands.find(
        c => c.type === "cmd/send-sync-response",
      )
      const broadcastEphemeral = command.commands.find(
        c => c.type === "cmd/broadcast-ephemeral",
      )
      const reciprocalRequest = command.commands.find(
        c => c.type === "cmd/send-message",
      )

      expect(syncResponse).toBeDefined()
      expect(broadcastEphemeral).toBeDefined()
      // Should NOT contain reciprocal request
      expect(reciprocalRequest).toBeUndefined()
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
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })
})
