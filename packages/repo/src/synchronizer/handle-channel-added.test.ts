import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import { createMockChannel } from "./test-utils.js"

describe("handle-channel-added", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should add channel to model without sending establish request", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })
    const channel = createMockChannel()

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-added",
      channel,
    }

    const [newModel, command] = update(message, initialModel)

    expect(newModel.channels.get(channel.channelId)).toBe(channel)
    // Channel-added no longer sends establish-request automatically
    expect(command).toBeUndefined()
  })
})
