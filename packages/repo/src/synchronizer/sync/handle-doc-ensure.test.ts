import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createRules } from "../../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import {
  createEstablishedChannel,
  createModelWithChannel,
  expectBatchCommand,
  expectCommand,
} from "../test-utils.js"

describe("handle-doc-ensure", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      rules: createRules(),
    })
  })

  it("should create document and request from all channels", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId, { channelId: 1 })
    const initialModel = createModelWithChannel(channel)

    // Add peer state
    initialModel.peers.set(peerId, {
      identity: { peerId, name: "test-peer", type: "user" },
      documentAwareness: new Map(),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set([channel.channelId]),
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-ensure",
      docId: "new-doc",
    }

    const [newModel, command] = update(message, initialModel)

    // Document should be created
    expect(newModel.documents.has("new-doc")).toBe(true)
    const docState = newModel.documents.get("new-doc")
    expect(docState?.docId).toBe("new-doc")
    expect(docState?.doc).toBeDefined()

    // Should send sync-request and subscribe
    expectBatchCommand(command)
    expect(command.commands).toHaveLength(3)

    const cmd0 = command.commands[0]
    const cmd1 = command.commands[1]
    const cmd2 = command.commands[2]

    expectCommand(cmd0, "cmd/send-message")
    expect(cmd0.envelope.message.type).toBe("channel/sync-request")
    if (cmd0.envelope.message.type === "channel/sync-request") {
      expect(cmd0.envelope.message.docs).toHaveLength(1)
      expect(cmd0.envelope.message.docs[0].docId).toBe("new-doc")
    }

    expectCommand(cmd1, "cmd/subscribe-doc")
    expect(cmd1.docId).toBe("new-doc")

    expectCommand(cmd2, "cmd/emit-ready-state-changed")
    expect(cmd2.docId).toBe("new-doc")
  })

  it("should do nothing if document already exists", () => {
    const peerId = "test-peer-id" as PeerID
    const channel = createEstablishedChannel(peerId)
    const initialModel = createModelWithChannel(channel)

    // Pre-create the document
    const ensureMessage: SynchronizerMessage = {
      type: "synchronizer/doc-ensure",
      docId: "existing-doc",
    }
    const [modelWithDoc] = update(ensureMessage, initialModel)

    // Try to ensure again
    const [newModel, command] = update(ensureMessage, modelWithDoc)

    // Model should be unchanged
    expect(newModel).toBe(modelWithDoc)
    // No command should be issued
    expect(command).toBeUndefined()
  })

  it("should respect canReveal permissions when requesting", () => {
    const restrictivePermissions = createRules({
      canReveal: context => {
        // Only reveal to storage adapters, not network peers
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

    const initialModel = createModelWithChannel(networkPeer)
    initialModel.channels.set(storagePeer.channelId, storagePeer)

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

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-ensure",
      docId: "restricted-doc",
    }

    const [_newModel, command] = restrictiveUpdate(message, initialModel)

    // Should only send to storage channel
    expectBatchCommand(command)
    expect(command.commands).toHaveLength(3) // sync-request + subscribe + ready-state-changed

    const syncCmd = command.commands[0]
    expectCommand(syncCmd, "cmd/send-message")
    expect(syncCmd.envelope.toChannelIds).toEqual([2]) // Only storage channel
  })
})
