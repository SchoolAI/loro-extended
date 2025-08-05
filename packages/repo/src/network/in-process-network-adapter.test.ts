import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PeerId } from "../types.js"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./in-process-network-adapter.js"
import type { AnnounceDocumentMessage } from "./network-messages.js"

describe("InProcessNetworkAdapter", () => {
  let broker: InProcessNetworkBroker

  beforeEach(() => {
    broker = new InProcessNetworkBroker()
  })

  it("should allow two peers to connect and exchange messages", async () => {
    const adapter1 = new InProcessNetworkAdapter(broker)
    const adapter2 = new InProcessNetworkAdapter(broker)

    const peer1Id = "peer1" as PeerId
    const peer2Id = "peer2" as PeerId

    const peer1CandidateMock = vi.fn()
    const peer2CandidateMock = vi.fn()
    adapter1.on("peer-candidate", peer1CandidateMock)
    adapter2.on("peer-candidate", peer2CandidateMock)

    // Connect the first peer
    adapter1.connect(peer1Id, {})

    // The first peer should not see any candidates yet
    expect(peer1CandidateMock).not.toHaveBeenCalled()

    // Connect the second peer
    adapter2.connect(peer2Id, {})

    await new Promise(resolve => setTimeout(resolve, 0))

    // Now they should see each other
    expect(peer1CandidateMock).toHaveBeenCalledWith({
      peerId: peer2Id,
      metadata: {},
    })
    expect(peer2CandidateMock).toHaveBeenCalledWith({
      peerId: peer1Id,
      metadata: {},
    })

    const messageMock = vi.fn()
    adapter2.on("message", messageMock)

    const message: AnnounceDocumentMessage = {
      type: "announce-document",
      senderId: peer1Id,
      targetIds: [peer2Id],
      documentIds: ["docA", "docB"],
    }
    adapter1.send(message)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(messageMock).toHaveBeenCalledWith(message)
  })

  it("should notify peers of disconnection", async () => {
    const adapter1 = new InProcessNetworkAdapter(broker)
    const adapter2 = new InProcessNetworkAdapter(broker)

    const peer1Id = "peer1" as PeerId
    const peer2Id = "peer2" as PeerId

    adapter1.connect(peer1Id, {})
    adapter2.connect(peer2Id, {})

    const disconnectMock = vi.fn()
    adapter2.on("peer-disconnected", disconnectMock)

    adapter1.disconnect()

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(disconnectMock).toHaveBeenCalledWith({ peerId: peer1Id })
  })
})
