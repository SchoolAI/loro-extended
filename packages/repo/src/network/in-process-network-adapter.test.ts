import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChannelId } from "../types.js"
import {
  InProcessBridge,
  InProcessNetworkAdapter,
} from "./in-process-network-adapter.js"
import type { ChannelMsgDirectoryRequest } from "../channel.js"

describe("InProcessNetworkAdapter", () => {
  let bridge: InProcessBridge

  beforeEach(() => {
    bridge = new InProcessBridge()
  })

  it("should allow two peers to connect and exchange messages", async () => {
    const peer1Id: ChannelId = "peer1"
    const peer2Id: ChannelId = "peer2"

    const adapter1 = new InProcessNetworkAdapter(bridge)
    const adapter2 = new InProcessNetworkAdapter(bridge)

    const messageMock1 = vi.fn()
    const messageMock2 = vi.fn()
    adapter1.on("message-received", messageMock1)
    adapter2.on("message-received", messageMock2)

    // Connect peers
    adapter1.start(peer1Id)
    adapter2.start(peer2Id)

    adapter1.markAsReady()
    adapter2.markAsReady()

    // Verify peers are connected in the peer state manager
    expect(bridge.peerIds).toEqual(new Set([peer1Id, peer2Id]))

    const message: ChannelMsgDirectoryRequest = {
      type: "channel/directory-request",
      senderId: peer1Id,
      targetIds: [peer2Id],
    }
    adapter1.send(message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(messageMock2).toHaveBeenCalledWith({ message })
  })

  it("should handle sending messages to non-existent peers gracefully", async () => {
    const adapter = new InProcessNetworkAdapter(bridge)
    const peerId: ChannelId = "peer1"
    const nonExistentPeerId: ChannelId = "non-existent"

    adapter.start(peerId)

    const message: ChannelMsgDirectoryRequest = {
      type: "channel/directory-request",
      senderId: peerId,
      targetIds: [nonExistentPeerId],
    }

    // This should not throw an error
    expect(() => adapter.send(message)).not.toThrow()
  })

  it("should handle sending messages to multiple peers", async () => {
    const adapter1 = new InProcessNetworkAdapter(bridge) // sender
    const adapter2 = new InProcessNetworkAdapter(bridge) // receiver 1
    const adapter3 = new InProcessNetworkAdapter(bridge) // receiver 2
    const adapter4 = new InProcessNetworkAdapter(bridge) // not in address list

    const messageMock2 = vi.fn()
    const messageMock3 = vi.fn()
    const messageMock4 = vi.fn()
    adapter2.on("message-received", messageMock2)
    adapter3.on("message-received", messageMock3)
    adapter4.on("message-received", messageMock4)

    const peer1Id: ChannelId = "peer1"
    const peer2Id: ChannelId = "peer2"
    const peer3Id: ChannelId = "peer3"
    const peer4Id: ChannelId = "peer4"

    adapter1.start(peer1Id)
    adapter2.start(peer2Id)
    adapter3.start(peer3Id)
    adapter4.start(peer4Id)

    adapter1.markAsReady()
    adapter2.markAsReady()
    adapter3.markAsReady()
    adapter4.markAsReady()

    const message: ChannelMsgDirectoryRequest = {
      type: "channel/directory-request",
      senderId: peer1Id,
      targetIds: [peer2Id, peer3Id],
    }

    adapter1.send(message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(messageMock2).toHaveBeenCalledWith({ message })
    expect(messageMock3).toHaveBeenCalledWith({ message })
    expect(messageMock4).not.toHaveBeenCalledWith({ message })
  })

  it("should handle sending a message with empty target IDs array", async () => {
    const adapter = new InProcessNetworkAdapter(bridge)
    const peerId: ChannelId = "peer1"

    adapter.start(peerId)

    const message: ChannelMsgDirectoryRequest = {
      type: "channel/directory-request",
      senderId: peerId,
      targetIds: [],
    }

    // This should not throw an error
    expect(() => adapter.send(message)).not.toThrow()
  })
})
