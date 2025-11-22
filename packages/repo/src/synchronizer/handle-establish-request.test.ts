import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { isEstablished } from "../channel.js"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import {
  createMockChannel,
  createModelWithChannel,
  expectCommand,
} from "./test-utils.js"

describe("handle-establish-request", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should establish channel and send response", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/establish-request",
          identity: {
            peerId: "1",
            name: "test",
            type: "user",
          },
        },
      },
    }

    const [newModel, command] = update(message, initialModel)

    // Channel should be established
    const updatedChannel = newModel.channels.get(channel.channelId)
    if (!updatedChannel) {
      throw new Error("updatedChannel expected")
    }

    expect(isEstablished(updatedChannel)).toBe(true)
    if (isEstablished(updatedChannel)) {
      const peerState = newModel.peers.get(updatedChannel.peerId)
      expect(peerState?.identity.name).toBe("test")
    }

    // Should return only establish-response (no sync-request)
    expectCommand(command, "cmd/send-establishment-message")
  })
})
