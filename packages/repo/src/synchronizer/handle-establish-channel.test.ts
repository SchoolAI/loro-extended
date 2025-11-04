import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import {
  createMockChannel,
  createModelWithChannel,
  expectCommand,
} from "./test-utils.js"

describe("handle-establish-channel", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should send establish-request for existing channel", () => {
    const channel = createMockChannel({ channelId: 42 })
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/establish-channel",
      channelId: 42,
    }

    const [newModel, command] = update(message, initialModel)

    // Model should be unchanged
    expect(newModel).toBe(initialModel)

    // Should send establish-request
    expectCommand(command, "cmd/send-establishment-message")
    expect(command.envelope.toChannelIds).toEqual([42])
    expect(command.envelope.message.type).toBe("channel/establish-request")
    expect(command.envelope.message.identity).toEqual(initialModel.identity)
  })

  it("should log error when channel not found", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/establish-channel",
      channelId: 999,
    }

    const [_newModel, command] = update(message, initialModel)

    expectCommand(command, "cmd/log")
    expect(command.message).toContain("channel 999 not found")
  })
})
