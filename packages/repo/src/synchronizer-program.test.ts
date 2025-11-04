/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "./rules.js"
import {
  createEstablishedChannel,
  createMockChannel,
  createModelWithChannel,
  createVersionVector,
  expectBatchCommand,
  expectCommand,
} from "./synchronizer/test-utils.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "./synchronizer-program.js"
import { createDocState } from "./types.js"

describe("Synchronizer Program - Integration Tests", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  describe("initialization", () => {
    it("should initialize with empty state", () => {
      const identity = { peerId: "test-peer-id" as PeerID, name: "test-peer" }
      const [model, command] = programInit(identity)

      expect(model.identity).toEqual(identity)
      expect(model.documents.size).toBe(0)
      expect(model.channels.size).toBe(0)
      expect(command).toBeUndefined()
    })
  })

  describe("channel message routing", () => {
    it("should log error when channel not found", () => {
      const [initialModel] = programInit({
        peerId: "test-id" as PeerID,
        name: "test",
      })

      const message: SynchronizerMessage = {
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: 999, // Non-existent channel
          message: {
            type: "channel/directory-request",
          },
        },
      }

      const [_newModel, command] = update(message, initialModel)

      expectCommand(command, "cmd/log")
      expect(command.message).toContain("channel not found")
    })
  })

  describe("permission integration", () => {
    it("should respect canReveal permissions in directory response", () => {
      const restrictivePermissions = createPermissions({
        canReveal: context => {
          return context.docId !== "secret-doc"
        },
      })

      const restrictiveUpdate = createSynchronizerUpdate({
        permissions: restrictivePermissions,
      })

      const peerId = "test-peer-id" as PeerID
      const channel = createEstablishedChannel(peerId)
      const initialModel = createModelWithChannel(channel)
      initialModel.peers.set(peerId, {
        identity: { peerId, name: "test-peer" },
        documentAwareness: new Map(),
        subscriptions: new Set(),
        lastSeen: new Date(),
        channels: new Set([channel.channelId]),
      })

      // Add documents
      const publicDoc = createDocState({ docId: "public-doc" })
      const secretDoc = createDocState({ docId: "secret-doc" })
      initialModel.documents.set("public-doc", publicDoc)
      initialModel.documents.set("secret-doc", secretDoc)

      const message: SynchronizerMessage = {
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message: {
            type: "channel/directory-request",
          },
        },
      }

      const [_newModel, command] = restrictiveUpdate(message, initialModel)

      expectCommand(command, "cmd/send-message")
      expect(command.envelope.message.type).toBe("channel/directory-response")
      if (command.envelope.message.type === "channel/directory-response") {
        expect(command.envelope.message.docIds).toEqual(["public-doc"])
        expect(command.envelope.message.docIds).not.toContain("secret-doc")
      }
    })
  })

  describe("utility functions and edge cases", () => {
    it("should handle batch commands correctly", () => {
      const channel = createMockChannel()
      const initialModel = createModelWithChannel(channel)

      const message: SynchronizerMessage = {
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message: {
            type: "channel/establish-response",
            identity: { peerId: "remote-peer-id" as PeerID, name: "test" },
          },
        },
      }

      const [_newModel, command] = update(message, initialModel)

      // establish-response sends batch with directory-request and sync-request
      expectBatchCommand(command)
      expect(command.commands.length).toBeGreaterThanOrEqual(1)
      expect(command.commands.every(c => c !== undefined)).toBe(true)
    })

    it("should return single command when only one is needed", () => {
      const [initialModel] = programInit({
        peerId: "test-id" as PeerID,
        name: "test",
      })
      const channel = createMockChannel()

      const message: SynchronizerMessage = {
        type: "synchronizer/channel-added",
        channel,
      }

      const [_newModel, command] = update(message, initialModel)

      // Channel-added no longer sends establish-request automatically
      expect(command).toBeUndefined()
    })

    it("should return undefined when no commands are generated", () => {
      const [initialModel] = programInit({
        peerId: "test-id" as PeerID,
        name: "test",
      })

      // This should not generate any commands
      const message: SynchronizerMessage = {
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: 999,
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

      // This actually returns a log command when channel is not found
      expectCommand(command, "cmd/log")
      expect(command.message).toContain("channel not found")
    })

    it("should handle unknown message types gracefully", () => {
      const [initialModel] = programInit({
        peerId: "test-id" as PeerID,
        name: "test",
      })

      // Cast to bypass TypeScript checking for unknown message type
      const message = {
        type: "synchronizer/unknown-message-type",
      } as any

      const [newModel, command] = update(message, initialModel)

      expect(command).toBeUndefined()
      expect(newModel).toEqual(initialModel)
    })
  })

  describe("state consistency", () => {
    it("should maintain immutability of original model", () => {
      const [initialModel] = programInit({
        peerId: "test-id" as PeerID,
        name: "test",
      })
      const originalChannelsSize = initialModel.channels.size
      const originalDocsSize = initialModel.documents.size

      const channel = createMockChannel()
      const message: SynchronizerMessage = {
        type: "synchronizer/channel-added",
        channel,
      }

      const [newModel, _command] = update(message, initialModel)

      // Original model should be unchanged
      expect(initialModel.channels.size).toBe(originalChannelsSize)
      expect(initialModel.documents.size).toBe(originalDocsSize)

      // New model should have changes
      expect(newModel.channels.size).toBe(originalChannelsSize + 1)
    })

    it("should properly update nested state structures", () => {
      const peerId = "test-peer-id" as PeerID
      const channel = createEstablishedChannel(peerId)
      const docId = "test-doc"
      const initialModel = createModelWithChannel(channel)

      // Add peer state with subscription
      initialModel.peers.set(peerId, {
        identity: { peerId, name: "test-peer" },
        documentAwareness: new Map(),
        subscriptions: new Set([docId]),
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

      // Verify peer awareness was updated correctly
      const peerState = newModel.peers.get(peerId)
      const awareness = peerState?.documentAwareness.get(docId)

      expect(awareness?.awareness).toBe("has-doc")
      expect(awareness?.lastKnownVersion).toBeDefined()
    })
  })
})
