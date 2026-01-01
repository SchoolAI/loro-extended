import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../../permissions.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import {
  createEstablishedChannel,
  createMockChannel,
  createModelWithChannel,
  expectCommand,
} from "../test-utils.js"

describe("handle-channel-removed", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should remove channel from model and return stop-channel command", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-removed",
      channel,
    }

    const [newModel, command] = update(message, initialModel)

    expect(newModel.channels.has(channel.channelId)).toBe(false)
    expectCommand(command, "cmd/stop-channel")
    expect(command.channel.channelId).toBe(channel.channelId)
  })

  it("should update peer state when channel is removed", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state with this channel
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-removed",
      channel,
    }

    const [newModel, _command] = update(message, initialModel)

    const peerState = newModel.peers.get(peerId)
    expect(peerState?.channels.has(channel.channelId)).toBe(false)
  })

  it("should log error when channel doesn't exist", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })
    const channel = createMockChannel()

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-removed",
      channel,
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })
})
