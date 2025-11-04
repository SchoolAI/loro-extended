import { LoroDoc, type PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { isEstablished } from "../channel.js"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import { createDocState } from "../types.js"
import {
  createMockChannel,
  createModelWithChannel,
  createModelWithKnownPeer,
  createVersionVector,
  expectBatchCommand,
  expectCommand,
  sendEstablishResponse,
} from "./test-utils.js"

describe("handle-establish-response", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should establish channel and send discovery messages", () => {
    const channel = createMockChannel()
    const initialModel = createModelWithChannel(channel)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/establish-response",
          identity: { peerId: "remote-peer-id" as PeerID, name: "test" },
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

    // Should return batch command with directory-request and sync-request
    expectBatchCommand(command)
    expect(command.commands.length).toBeGreaterThanOrEqual(1)
  })

  describe("reconnection detection", () => {
    it("performs full discovery for new peer", () => {
      const channel = createMockChannel()
      const model = createModelWithChannel(channel)
      model.documents.set("doc-1", createDocState({ docId: "doc-1" }))
      model.documents.set("doc-2", createDocState({ docId: "doc-2" }))

      const [newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "new-peer" as PeerID,
        update,
      )

      // Creates peer state
      expect(newModel.peers.has("new-peer" as PeerID)).toBe(true)

      // Sends directory-request + sync-request
      expectBatchCommand(command)
      expect(command.commands).toHaveLength(2)
      const cmd0 = command.commands[0]
      const cmd1 = command.commands[1]
      expectCommand(cmd0, "cmd/send-message")
      expectCommand(cmd1, "cmd/send-message")
      expect(cmd0.envelope.message.type).toBe("channel/directory-request")
      expect(cmd1.envelope.message.type).toBe("channel/sync-request")
      if (cmd1.envelope.message.type === "channel/sync-request") {
        expect(cmd1.envelope.message.docs).toHaveLength(2)
      }
    })

    it("skips directory-request for known peer", () => {
      const channel = createMockChannel()
      const model = createModelWithKnownPeer(
        channel,
        "known-peer" as PeerID,
        new Map([
          ["doc-1", { awareness: "has-doc", version: createVersionVector() }],
        ]),
      )
      model.documents.set("doc-1", createDocState({ docId: "doc-1" }))
      model.documents.set("doc-2", createDocState({ docId: "doc-2" }))

      const [_newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "known-peer" as PeerID,
        update,
      )

      // Only syncs new doc-2 (no directory-request)
      expectCommand(command, "cmd/send-message")
      expect(command.envelope.message.type).toBe("channel/sync-request")
      if (command.envelope.message.type === "channel/sync-request") {
        expect(command.envelope.message.docs).toHaveLength(1)
        expect(command.envelope.message.docs[0].docId).toBe("doc-2")
      }
    })

    it("syncs only changed documents on reconnection", () => {
      const channel = createMockChannel()
      const doc = createDocState({ docId: "doc-1" })
      doc.doc.getText("text").insert(0, "new content")
      const oldVersion = new LoroDoc().version()

      const model = createModelWithKnownPeer(
        channel,
        "known-peer" as PeerID,
        new Map([["doc-1", { awareness: "has-doc", version: oldVersion }]]),
      )
      model.documents.set("doc-1", doc)

      const [_newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "known-peer" as PeerID,
        update,
      )

      expectCommand(command, "cmd/send-message")
      if (command.envelope.message.type === "channel/sync-request") {
        expect(command.envelope.message.docs).toHaveLength(1)
        expect(command.envelope.message.docs[0].docId).toBe("doc-1")
        expect(command.envelope.message.docs[0].requesterDocVersion).toEqual(
          oldVersion,
        ) // Incremental sync
      }
    })

    it("skips unchanged documents on reconnection", () => {
      const channel = createMockChannel()
      const doc = createDocState({ docId: "doc-1" })
      doc.doc.getText("text").insert(0, "content")
      const currentVersion = doc.doc.version()

      const model = createModelWithKnownPeer(
        channel,
        "known-peer" as PeerID,
        new Map([["doc-1", { awareness: "has-doc", version: currentVersion }]]),
      )
      model.documents.set("doc-1", doc)

      const [_newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "known-peer" as PeerID,
        update,
      )

      expect(command).toBeUndefined() // No sync needed
    })

    it("skips documents peer doesn't have", () => {
      const channel = createMockChannel()
      const model = createModelWithKnownPeer(
        channel,
        "known-peer" as PeerID,
        new Map([["doc-1", { awareness: "no-doc" }]]),
      )
      model.documents.set("doc-1", createDocState({ docId: "doc-1" }))

      const [_newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "known-peer" as PeerID,
        update,
      )

      expect(command).toBeUndefined() // Don't sync docs they don't have
    })

    it("handles mixed new, changed, and unchanged docs", () => {
      const channel = createMockChannel()

      // doc-1: unchanged (same version)
      const doc1 = createDocState({ docId: "doc-1" })
      doc1.doc.getText("text").insert(0, "content1")
      const doc1Version = doc1.doc.version()

      // doc-2: changed (old version in cache)
      const doc2 = createDocState({ docId: "doc-2" })
      const doc2OldVersion = new LoroDoc().version()
      doc2.doc.getText("text").insert(0, "content2")

      // doc-3: new (not in cache)
      const doc3 = createDocState({ docId: "doc-3" })

      const model = createModelWithKnownPeer(
        channel,
        "known-peer" as PeerID,
        new Map([
          ["doc-1", { awareness: "has-doc", version: doc1Version }],
          ["doc-2", { awareness: "has-doc", version: doc2OldVersion }],
        ]),
      )
      model.documents.set("doc-1", doc1)
      model.documents.set("doc-2", doc2)
      model.documents.set("doc-3", doc3)

      const [_newModel, command] = sendEstablishResponse(
        model,
        channel.channelId,
        "known-peer" as PeerID,
        update,
      )

      // Should sync doc-2 (changed) and doc-3 (new), skip doc-1 (unchanged)
      expectCommand(command, "cmd/send-message")
      if (command.envelope.message.type === "channel/sync-request") {
        expect(command.envelope.message.docs).toHaveLength(2)
        const docIds = command.envelope.message.docs.map(d => d.docId).sort()
        expect(docIds).toEqual(["doc-2", "doc-3"])
      }
    })
  })
})
