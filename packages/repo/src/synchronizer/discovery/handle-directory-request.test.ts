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
  createModelWithChannel,
  expectCommand,
} from "../test-utils.js"

describe("handle-directory-request", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should respond with document list", () => {
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

    // Add some documents
    const doc1 = createDocState({ docId: "doc-1" })
    const doc2 = createDocState({ docId: "doc-2" })
    initialModel.documents.set("doc-1", doc1)
    initialModel.documents.set("doc-2", doc2)

    const message: SynchronizerMessage = {
      type: "synchronizer/channel-receive-message",
      envelope: {
        fromChannelId: channel.channelId,
        message: {
          type: "channel/directory-request",
        },
      },
    }

    const [_newModel, command] = update(message, initialModel)

    expectCommand(command, "cmd/send-message")
    expect(command.envelope.toChannelIds).toEqual([channel.channelId])
    expect(command.envelope.message.type).toBe("channel/directory-response")
    if (command.envelope.message.type === "channel/directory-response") {
      expect(command.envelope.message.docIds).toEqual(["doc-1", "doc-2"])
    }
  })
})
