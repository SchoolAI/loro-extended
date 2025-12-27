import { LoroDoc, type PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { isEstablished } from "../../channel.js"
import { createPermissions } from "../../permissions.js"
import {
  createSynchronizerUpdate,
  type SynchronizerMessage,
} from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import {
  createMockChannel,
  createModelWithChannel,
  createModelWithKnownPeer,
  createVersionVector,
  expectCommand,
  sendEstablishResponse,
} from "../test-utils.js"

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
    // Add a document so we have something to sync
    initialModel.documents.set("doc-1", createDocState({ docId: "doc-1" }))

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/establish-response",
          identity: {
            peerId: "remote-peer-id" as PeerID,
            name: "test",
            type: "user",
          },
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

    // Should return sync-request command
    expectCommand(command, "cmd/send-sync-request")
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
        "1",
        update,
      )

      // Creates peer state
      expect(newModel.peers.has("1")).toBe(true)

      // Sends sync-request command
      expectCommand(command, "cmd/send-sync-request")
      expect(command.docs).toHaveLength(2)
      expect(command.bidirectional).toBe(true)
      expect(command.includeEphemeral).toBe(true)
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
      expectCommand(command, "cmd/send-sync-request")
      expect(command.docs).toHaveLength(1)
      expect(command.docs[0].docId).toBe("doc-2")
      expect(command.bidirectional).toBe(true)
      expect(command.includeEphemeral).toBe(true)
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

      // Now returns sync-request command
      expectCommand(command, "cmd/send-sync-request")
      expect(command.docs).toHaveLength(1)
      expect(command.docs[0].docId).toBe("doc-1")
      expect(command.docs[0].requesterDocVersion).toEqual(oldVersion) // Incremental sync
      expect(command.includeEphemeral).toBe(true)
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

      // No sync needed
      expect(command).toBeUndefined()
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

      // Don't sync docs they don't have
      expect(command).toBeUndefined()
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
      expectCommand(command, "cmd/send-sync-request")
      expect(command.docs).toHaveLength(2)
      const docIds = command.docs.map((d: { docId: string }) => d.docId).sort()
      expect(docIds).toEqual(["doc-2", "doc-3"])
      expect(command.includeEphemeral).toBe(true)
    })
  })
})
