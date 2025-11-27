import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createRules } from "../../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import {
  createEstablishedChannel,
  createModelWithChannel,
  expectBatchCommand,
  expectCommand,
} from "../test-utils.js"

describe("handle-local-doc-change", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      rules: createRules(),
    })
  })

  it("should send sync-response to peers who requested updates", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add document first
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    // Add initial content so version is not empty
    docState.doc.getMap("init").set("a", 1)

    // Capture the initial version
    const initialVersion = docState.doc.version()

    // Make a change to the document so it's ahead of the peer
    docState.doc.getMap("test").set("key", "value")

    // Add peer state with subscription and OLD version
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map([
        [
          docId,
          {
            awareness: "has-doc",
            lastKnownVersion: initialVersion, // Peer has the old version
            lastUpdated: new Date(),
          },
        ],
      ]),
      subscriptions: new Set([docId]),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId,
    }

    const [_newModel, command] = update(message, initialModel)

    // Should send sync-response with update
    expectCommand(command, "cmd/send-message")
    expect(command.envelope.toChannelIds).toEqual([1])
    expect(command.envelope.message.type).toBe("channel/sync-response")
    if (command.envelope.message.type === "channel/sync-response") {
      expect(command.envelope.message.docId).toBe(docId)
      expect(command.envelope.message.transmission.type).toBe("update")
      // Data is now exported per-peer, so we just check it exists
      if (command.envelope.message.transmission.type === "update") {
        expect(command.envelope.message.transmission.data).toBeDefined()
      }
    }
  })

  it("should send directory-response announcement to peers with unknown awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add peer state with no document awareness
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId,
    }

    const [_newModel, command] = update(message, initialModel)

    // Should send directory-response as announcement
    expectCommand(command, "cmd/send-message")
    expect(command.envelope.toChannelIds).toEqual([1])
    expect(command.envelope.message.type).toBe("channel/directory-response")
    if (command.envelope.message.type === "channel/directory-response") {
      expect(command.envelope.message.docIds).toEqual([docId])
    }
  })

  it("should send nothing to peers with no-doc awareness", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const docId = "test-doc"
    const initialModel = createModelWithChannel(channel)

    // Add peer state with no-doc awareness
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map([
        [docId, { awareness: "no-doc", lastUpdated: new Date() }],
      ]),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId,
    }

    const [_newModel, command] = update(message, initialModel)

    // Should send nothing
    expect(command).toBeUndefined()
  })

  it("should respect canReveal permissions", () => {
    const restrictivePermissions = createRules({
      canReveal: context => {
        // Only reveal to storage adapters
        return context.channelKind === "storage"
      },
    })

    const restrictiveUpdate = createSynchronizerUpdate({
      rules: restrictivePermissions,
    })

    const networkPeer = createEstablishedChannel("network-peer" as PeerID, {
      channelId: 1,
      kind: "network",
    })
    const storagePeer = createEstablishedChannel("storage-peer" as PeerID, {
      channelId: 2,
      kind: "storage",
    })

    const docId = "restricted-doc"
    const initialModel = createModelWithChannel(networkPeer)
    initialModel.channels.set(storagePeer.channelId, storagePeer)

    // Add peer states
    initialModel.peers.set("network-peer" as PeerID, {
      identity: {
        peerId: "network-peer" as PeerID,
        name: "network",
        type: "user",
      },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([networkPeer.channelId]),
    })
    initialModel.peers.set("storage-peer" as PeerID, {
      identity: {
        peerId: "storage-peer" as PeerID,
        name: "storage",
        type: "service",
      },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([storagePeer.channelId]),
    })

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId,
    }

    const [_newModel, command] = restrictiveUpdate(message, initialModel)

    // Should only send to storage channel
    expectCommand(command, "cmd/send-message")
    expect(command.envelope.toChannelIds).toEqual([2]) // Only storage
  })

  it("should handle multiple channels with different states", () => {
    const peer1 = createEstablishedChannel("peer-1" as PeerID, {
      channelId: 1,
    })
    const peer2 = createEstablishedChannel("peer-2" as PeerID, {
      channelId: 2,
    })
    const docId = "test-doc"
    const initialModel = createModelWithChannel(peer1)
    initialModel.channels.set(peer2.channelId, peer2)

    // Add document
    const docState = createDocState({ docId })
    initialModel.documents.set(docId, docState)

    // Add initial content
    docState.doc.getMap("init").set("a", 1)

    // Capture initial version
    const initialVersion = docState.doc.version()

    // Make change
    docState.doc.getMap("test").set("key", "value")

    // Peer 1: has subscription and OLD version
    initialModel.peers.set("peer-1" as PeerID, {
      identity: { peerId: "peer-1" as PeerID, name: "peer1", type: "user" },
      documentAwareness: new Map([
        [
          docId,
          {
            awareness: "has-doc",
            lastKnownVersion: initialVersion,
            lastUpdated: new Date(),
          },
        ],
      ]),
      subscriptions: new Set([docId]),
      lastSeen: new Date(),
      channels: new Set([peer1.channelId]),
    })

    // Peer 2: unknown awareness, no subscription
    initialModel.peers.set("peer-2" as PeerID, {
      identity: { peerId: "peer-2" as PeerID, name: "peer2", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([peer2.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId,
    }

    const [_newModel, command] = update(message, initialModel)

    // Should send to both channels with different messages
    expectBatchCommand(command)
    expect(command.commands).toHaveLength(2)

    const cmd0 = command.commands[0]
    const cmd1 = command.commands[1]

    expectCommand(cmd0, "cmd/send-message")
    expectCommand(cmd1, "cmd/send-message")

    // One should be sync-response, one should be directory-response
    const messages = [cmd0.envelope.message, cmd1.envelope.message]
    const types = messages.map(m => m.type).sort()
    expect(types).toEqual([
      "channel/directory-response",
      "channel/sync-response",
    ])
  })

  it("should log error when document not found", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/local-doc-change",
      docId: "nonexistent-doc",
    }

    const [_newModel, command] = update(message, initialModel)

    expect(command).toBeUndefined()
  })
})
