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
      identity: { peerId, name: "test-peer" },
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
    expectCommand(command, "cmd/send-sync-response")
    expect(command.docId).toBe(docId)
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

    expectCommand(command, "cmd/log")
    expect(command.message).toContain("non-established")
  })
})
