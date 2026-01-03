import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../../permissions.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import {
  createDocState,
  createEstablishedChannel,
  createMockChannel,
  createModelWithChannel,
} from "../test-utils.js"

describe("handle-new-doc", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should create documents and set peer awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/new-doc",
          docIds: ["doc-1", "doc-2"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Documents should be created
    expect(newModel.documents.has("doc-1")).toBe(true)
    expect(newModel.documents.has("doc-2")).toBe(true)

    // Peer awareness should be updated to "pending"
    // (we know they have it, but we don't know their version yet - we'll learn it when we sync)
    const peerState = newModel.peers.get(peerId)
    expect(peerState?.docSyncStates.get("doc-1")?.status).toBe("pending")
    expect(peerState?.docSyncStates.get("doc-2")?.status).toBe("pending")
  })

  it("should update peer awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state with no document awareness
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/new-doc",
          docIds: ["doc-1", "doc-2"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Peer awareness should be updated to "pending"
    const peerState = newModel.peers.get(peerId)
    expect(peerState).toBeDefined()
    expect(peerState?.docSyncStates.get("doc-1")?.status).toBe("pending")
    expect(peerState?.docSyncStates.get("doc-2")?.status).toBe("pending")
    expect(peerState?.docSyncStates.get("doc-1")?.lastUpdated).toBeInstanceOf(
      Date,
    )
  })

  it("should reject from non-established channel", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/new-doc",
          docIds: ["doc-1"],
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })

  it("should update existing documents peer awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(),
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
          type: "channel/new-doc",
          docIds: ["existing-doc", "new-doc"],
        },
      },
    }

    const [newModel, _command] = update(message, initialModel)

    // Both documents should have peer awareness (pending)
    const peerState = newModel.peers.get(peerId)
    expect(peerState?.docSyncStates.get("existing-doc")?.status).toBe("pending")
    expect(peerState?.docSyncStates.get("new-doc")?.status).toBe("pending")

    // New document should be created
    expect(newModel.documents.has("new-doc")).toBe(true)
  })

  it("should send sync-request for announced documents", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      docSyncStates: new Map(),
      subscriptions: new Set(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/new-doc",
          docIds: ["doc-1"],
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    // Should have a batch command with sync-request
    expect(command).toBeDefined()
    expect(command?.type).toBe("cmd/batch")
    if (command?.type === "cmd/batch") {
      const syncRequestCmd = command.commands.find(
        cmd =>
          cmd?.type === "cmd/send-message" &&
          cmd.envelope.message.type === "channel/sync-request",
      )
      expect(syncRequestCmd).toBeDefined()
    }
  })
})
