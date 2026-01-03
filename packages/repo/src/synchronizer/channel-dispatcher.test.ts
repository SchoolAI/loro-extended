import { getLogger } from "@logtape/logtape"
import type { PeerID } from "loro-crdt"
import { describe, expect, it } from "vitest"
import type { ChannelMsgBatch } from "../channel.js"
import { createPermissions } from "../permissions.js"
import { channelDispatcher } from "./channel-dispatcher.js"
import {
  createDocState,
  createEstablishedChannel,
  createModelWithKnownPeer,
} from "./test-utils.js"

describe("channelDispatcher", () => {
  describe("channel/batch", () => {
    it("should dispatch each message in a batch and return batched commands", () => {
      const peerId = "1" as PeerID
      const docId1 = "doc-1"
      const docId2 = "doc-2"

      const channel = createEstablishedChannel(peerId)
      const model = createModelWithKnownPeer(channel, peerId)

      // Add documents to the model
      model.documents.set(docId1, createDocState({ docId: docId1 }))
      model.documents.set(docId2, createDocState({ docId: docId2 }))

      // Add subscriptions to peer state
      const peerState = model.peers.get(peerId)
      if (!peerState) throw new Error("peerState not found")
      peerState.subscriptions.add(docId1)
      peerState.subscriptions.add(docId2)

      const permissions = createPermissions({})
      const logger = getLogger(["test"])

      // Create a batch of ephemeral messages
      const batchMessage: ChannelMsgBatch = {
        type: "channel/batch",
        messages: [
          {
            type: "channel/ephemeral",
            docId: docId1,
            hopsRemaining: 1,
            stores: [
              {
                peerId,
                data: new Uint8Array([1, 2, 3]),
                namespace: "presence",
              },
            ],
          },
          {
            type: "channel/ephemeral",
            docId: docId2,
            hopsRemaining: 1,
            stores: [
              {
                peerId,
                data: new Uint8Array([4, 5, 6]),
                namespace: "presence",
              },
            ],
          },
        ],
      }

      const result = channelDispatcher(
        batchMessage,
        model,
        channel.channelId,
        permissions,
        logger,
      )

      // Should return a batched command with commands for each message
      expect(result).toBeDefined()
      expect(result?.type).toBe("cmd/batch")
      if (result?.type === "cmd/batch") {
        // Each ephemeral message should produce a cmd/apply-ephemeral command
        expect(result.commands.length).toBe(2)
        expect(result.commands[0]?.type).toBe("cmd/apply-ephemeral")
        expect(result.commands[1]?.type).toBe("cmd/apply-ephemeral")
      }
    })

    it("should handle empty batch", () => {
      const peerId = "1" as PeerID

      const channel = createEstablishedChannel(peerId)
      const model = createModelWithKnownPeer(channel, peerId)

      const permissions = createPermissions({})
      const logger = getLogger(["test"])

      const batchMessage: ChannelMsgBatch = {
        type: "channel/batch",
        messages: [],
      }

      const result = channelDispatcher(
        batchMessage,
        model,
        channel.channelId,
        permissions,
        logger,
      )

      // Empty batch should return undefined (no commands)
      expect(result).toBeUndefined()
    })

    it("should handle batch with single message", () => {
      const peerId = "1" as PeerID
      const docId = "doc-1"

      const channel = createEstablishedChannel(peerId)
      const model = createModelWithKnownPeer(channel, peerId)

      // Add document to the model
      model.documents.set(docId, createDocState({ docId }))

      // Add subscription to peer state
      const peerState = model.peers.get(peerId)
      if (!peerState) throw new Error("peerState not found")
      peerState.subscriptions.add(docId)

      const permissions = createPermissions({})
      const logger = getLogger(["test"])

      const batchMessage: ChannelMsgBatch = {
        type: "channel/batch",
        messages: [
          {
            type: "channel/ephemeral",
            docId,
            hopsRemaining: 1,
            stores: [
              {
                peerId,
                data: new Uint8Array([1, 2, 3]),
                namespace: "presence",
              },
            ],
          },
        ],
      }

      const result = channelDispatcher(
        batchMessage,
        model,
        channel.channelId,
        permissions,
        logger,
      )

      // Single message batch should return the single command directly (not wrapped in cmd/batch)
      expect(result).toBeDefined()
      expect(result?.type).toBe("cmd/apply-ephemeral")
    })

    it("should handle batch with mixed message types", () => {
      const peerId = "1" as PeerID
      const docId = "doc-1"

      const channel = createEstablishedChannel(peerId)
      const model = createModelWithKnownPeer(channel, peerId)

      // Add document to the model
      model.documents.set(docId, createDocState({ docId }))

      // Add subscription to peer state
      const peerState = model.peers.get(peerId)
      if (!peerState) throw new Error("peerState not found")
      peerState.subscriptions.add(docId)

      const permissions = createPermissions({})
      const logger = getLogger(["test"])

      // Create a batch with different message types
      const batchMessage: ChannelMsgBatch = {
        type: "channel/batch",
        messages: [
          {
            type: "channel/ephemeral",
            docId,
            hopsRemaining: 1,
            stores: [
              {
                peerId,
                data: new Uint8Array([1, 2, 3]),
                namespace: "presence",
              },
            ],
          },
          {
            type: "channel/directory-request",
          },
        ],
      }

      const result = channelDispatcher(
        batchMessage,
        model,
        channel.channelId,
        permissions,
        logger,
      )

      // Should return a batched command
      expect(result).toBeDefined()
      expect(result?.type).toBe("cmd/batch")
      if (result?.type === "cmd/batch") {
        expect(result.commands.length).toBe(2)
        expect(result.commands[0]?.type).toBe("cmd/apply-ephemeral")
        expect(result.commands[1]?.type).toBe("cmd/send-message") // directory-response
      }
    })
  })
})
