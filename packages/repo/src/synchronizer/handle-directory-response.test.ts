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
  expectCommand,
} from "./test-utils.js"

describe("handle-directory-response", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should create documents and set channel awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/directory-response",
          docIds: ["doc-1", "doc-2"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Documents should be created
    expect(newModel.documents.has("doc-1")).toBe(true)
    expect(newModel.documents.has("doc-2")).toBe(true)

    // Peer awareness should be updated
    const peerState = newModel.peers.get(peerId)
    expect(peerState?.documentAwareness.get("doc-1")?.awareness).toBe("has-doc")
    expect(peerState?.documentAwareness.get("doc-2")?.awareness).toBe("has-doc")
  })

  it("should update peer awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state with no document awareness
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/directory-response",
          docIds: ["doc-1", "doc-2"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Peer awareness should be updated
    const peerState = newModel.peers.get(peerId)
    expect(peerState).toBeDefined()
    expect(peerState?.documentAwareness.get("doc-1")?.awareness).toBe("has-doc")
    expect(peerState?.documentAwareness.get("doc-2")?.awareness).toBe("has-doc")
    expect(
      peerState?.documentAwareness.get("doc-1")?.lastUpdated,
    ).toBeInstanceOf(Date)
  })

  it("should reject from non-established channel", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/directory-response",
          docIds: ["doc-1"],
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expectCommand(command, "cmd/log")
    expect(command.message).toContain("non-established")
  })

  it("should update existing documents peer awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add existing document
    const existingDoc = createDocState({ docId: "existing-doc" })
    initialModel.documents.set("existing-doc", existingDoc)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/directory-response",
          docIds: ["existing-doc", "new-doc"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Both documents should have peer awareness
    const peerState = newModel.peers.get(peerId)
    expect(peerState?.documentAwareness.get("existing-doc")?.awareness).toBe(
      "has-doc",
    )
    expect(peerState?.documentAwareness.get("new-doc")?.awareness).toBe(
      "has-doc",
    )

    // New document should be created
    expect(newModel.documents.has("new-doc")).toBe(true)
  })
})
