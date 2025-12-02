/**
 * Tests for the translation layer between loro-extended and Loro Protocol.
 */

import type {
  ChannelMsgEphemeral,
  ChannelMsgEstablishRequest,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ChannelMsgUpdate,
} from "@loro-extended/repo"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { MESSAGE_TYPE } from "../protocol/constants.js"
import {
  createTranslationContext,
  fromProtocolMessage,
  getDocId,
  getRoomId,
  registerRoom,
  toProtocolMessages,
  translateEstablishRequest,
  translateJoinResponse,
} from "../protocol/translation.js"
import type {
  DocUpdate,
  JoinRequest,
  JoinResponseOk,
} from "../protocol/types.js"

describe("TranslationContext", () => {
  it("creates empty context", () => {
    const ctx = createTranslationContext()
    expect(ctx.roomToDoc.size).toBe(0)
    expect(ctx.docToRoom.size).toBe(0)
  })

  it("registers room/doc mappings", () => {
    const ctx = createTranslationContext()
    registerRoom(ctx, "room-1", "doc-1")

    expect(ctx.roomToDoc.get("room-1")).toBe("doc-1")
    expect(ctx.docToRoom.get("doc-1")).toBe("room-1")
  })

  it("returns roomId as docId when not registered", () => {
    const ctx = createTranslationContext()
    expect(getDocId(ctx, "unknown-room")).toBe("unknown-room")
  })

  it("returns docId as roomId when not registered", () => {
    const ctx = createTranslationContext()
    expect(getRoomId(ctx, "unknown-doc")).toBe("unknown-doc")
  })

  it("returns registered mappings", () => {
    const ctx = createTranslationContext()
    registerRoom(ctx, "room-1", "doc-1")

    expect(getDocId(ctx, "room-1")).toBe("doc-1")
    expect(getRoomId(ctx, "doc-1")).toBe("room-1")
  })
})

/**
 * Helper to create an empty VersionVector.
 */
function createEmptyVersion() {
  const doc = new LoroDoc()
  return doc.version()
}

describe("toProtocolMessages", () => {
  it("translates sync-request to JoinRequests", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docs: [
        { docId: "doc-1", requesterDocVersion: version },
        { docId: "doc-2", requesterDocVersion: version },
      ],
      bidirectional: true,
    }

    const result = toProtocolMessages(msg, ctx)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect((result[0] as JoinRequest).roomId).toBe("doc-1")
    expect(result[1].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect((result[1] as JoinRequest).roomId).toBe("doc-2")
  })

  it("translates sync-request with ephemeral data to JoinRequest and DocUpdate messages", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    // This is the bug scenario: sync-request includes ephemeral data per doc
    // but the translation layer was ignoring it
    const msg: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docs: [
        {
          docId: "doc-1",
          requesterDocVersion: version,
          ephemeral: {
            peerId: "peer-123" as any,
            data: new Uint8Array([10, 11, 12]),
          },
        },
      ],
      bidirectional: true,
    }

    const result = toProtocolMessages(msg, ctx)

    // Should have 2 messages: JoinRequest for the doc, DocUpdate for ephemeral
    expect(result).toHaveLength(2)

    // First message should be the JoinRequest
    expect(result[0].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect((result[0] as JoinRequest).roomId).toBe("doc-1")

    // Second message should be the ephemeral data
    expect(result[1].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[1] as DocUpdate).crdtType).toBe("ephemeral")
    expect((result[1] as DocUpdate).roomId).toBe("doc-1")
  })

  it("translates sync-request with multiple docs and ephemeral data", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docs: [
        {
          docId: "doc-1",
          requesterDocVersion: version,
          ephemeral: {
            peerId: "peer-123" as any,
            data: new Uint8Array([10, 11, 12]),
          },
        },
        {
          docId: "doc-2",
          requesterDocVersion: version,
          // No ephemeral for doc-2
        },
      ],
      bidirectional: true,
    }

    const result = toProtocolMessages(msg, ctx)

    // Should have 3 messages: JoinRequest for doc-1, DocUpdate for doc-1 ephemeral, JoinRequest for doc-2
    expect(result).toHaveLength(3)

    expect(result[0].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect((result[0] as JoinRequest).roomId).toBe("doc-1")

    expect(result[1].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[1] as DocUpdate).crdtType).toBe("ephemeral")
    expect((result[1] as DocUpdate).roomId).toBe("doc-1")

    expect(result[2].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect((result[2] as JoinRequest).roomId).toBe("doc-2")
  })

  it("translates sync-response with update to DocUpdate", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "update",
        data: new Uint8Array([1, 2, 3]),
        version,
      },
    }

    const result = toProtocolMessages(msg, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).roomId).toBe("doc-1")
    expect((result[0] as DocUpdate).updates).toHaveLength(1)
    expect((result[0] as DocUpdate).updates[0]).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it("translates sync-response with snapshot to DocUpdate", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "snapshot",
        data: new Uint8Array([4, 5, 6]),
        version,
      },
    }

    const result = toProtocolMessages(msg, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).updates[0]).toEqual(
      new Uint8Array([4, 5, 6]),
    )
  })

  it("returns empty array for up-to-date sync-response", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "up-to-date",
        version,
      },
    }

    const result = toProtocolMessages(msg, ctx)
    expect(result).toHaveLength(0)
  })

  it("returns empty array for unavailable sync-response", () => {
    const ctx = createTranslationContext()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "unavailable",
      },
    }

    const result = toProtocolMessages(msg, ctx)
    expect(result).toHaveLength(0)
  })

  it("translates sync-response with ephemeral data to DocUpdate messages", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    // This is the bug scenario: sync-response includes ephemeral data
    // but the translation layer was ignoring it
    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "update",
        data: new Uint8Array([1, 2, 3]),
        version,
      },
      ephemeral: [
        {
          peerId: "peer-123" as any,
          data: new Uint8Array([10, 11, 12]),
        },
        {
          peerId: "peer-456" as any,
          data: new Uint8Array([20, 21, 22]),
        },
      ],
    }

    const result = toProtocolMessages(msg, ctx)

    // Should have 2 messages: one for document data, one for ephemeral
    expect(result).toHaveLength(2)

    // First message should be the document update
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).crdtType).toBe("loro")
    expect((result[0] as DocUpdate).updates[0]).toEqual(
      new Uint8Array([1, 2, 3]),
    )

    // Second message should be the ephemeral data
    expect(result[1].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[1] as DocUpdate).crdtType).toBe("ephemeral")
    expect((result[1] as DocUpdate).updates).toHaveLength(2)
  })

  it("translates sync-response with only ephemeral data (up-to-date transmission)", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    // When transmission is up-to-date but we have ephemeral data to send
    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "up-to-date",
        version,
      },
      ephemeral: [
        {
          peerId: "peer-123" as any,
          data: new Uint8Array([10, 11, 12]),
        },
      ],
    }

    const result = toProtocolMessages(msg, ctx)

    // Should have 1 message for ephemeral data even though doc is up-to-date
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).crdtType).toBe("ephemeral")
  })

  it("translates update message to DocUpdate", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: ChannelMsgUpdate = {
      type: "channel/update",
      docId: "doc-1",
      transmission: {
        type: "update",
        data: new Uint8Array([7, 8, 9]),
        version,
      },
    }

    const result = toProtocolMessages(msg, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).crdtType).toBe("loro")
  })

  it("translates ephemeral message to DocUpdate with ephemeral type", () => {
    const ctx = createTranslationContext()

    const msg: ChannelMsgEphemeral = {
      type: "channel/ephemeral",
      docId: "doc-1",
      hopsRemaining: 1,
      stores: [
        {
          peerId: "123456789" as any,
          data: new Uint8Array([10, 11, 12]),
        },
      ],
    }

    const result = toProtocolMessages(msg, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(MESSAGE_TYPE.DocUpdate)
    expect((result[0] as DocUpdate).crdtType).toBe("ephemeral")
    // The update now includes the peerId encoded with the data
    // Format: [peerIdLength (2 bytes)] [peerId (UTF-8)] [data]
    // "123456789" is 9 bytes, so: [0, 9, ...peerId bytes..., 10, 11, 12]
    const update = (result[0] as DocUpdate).updates[0]
    expect(update.length).toBe(2 + 9 + 3) // 2 bytes length + 9 bytes peerId + 3 bytes data
    // Verify the peerId length prefix
    expect(update[0]).toBe(0) // high byte of length
    expect(update[1]).toBe(9) // low byte of length (9 chars)
    // Verify the data at the end
    expect(update.slice(-3)).toEqual(new Uint8Array([10, 11, 12]))
  })

  it("returns empty array for establish-request", () => {
    const ctx = createTranslationContext()

    const msg: ChannelMsgEstablishRequest = {
      type: "channel/establish-request",
      identity: { peerId: "peer-1" as any, name: "Test", type: "user" },
    }

    const result = toProtocolMessages(msg, ctx)
    expect(result).toHaveLength(0)
  })

  it("uses registered room mappings", () => {
    const ctx = createTranslationContext()
    registerRoom(ctx, "custom-room", "doc-1")
    const version = createEmptyVersion()

    const msg: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "update",
        data: new Uint8Array([1]),
        version,
      },
    }

    const result = toProtocolMessages(msg, ctx)

    expect((result[0] as DocUpdate).roomId).toBe("custom-room")
  })
})

describe("fromProtocolMessage", () => {
  it("translates JoinRequest to sync-request", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: JoinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro",
      roomId: "room-1",
      authPayload: new Uint8Array(0),
      requesterVersion: version.encode(),
    }

    const result = fromProtocolMessage(msg, ctx)

    expect(result).not.toBeNull()
    expect(result?.docId).toBe("room-1")
    expect(result?.channelMsg.type).toBe("channel/sync-request")
  })

  it("translates JoinResponseOk to sync-response", () => {
    const ctx = createTranslationContext()
    const version = createEmptyVersion()

    const msg: JoinResponseOk = {
      type: MESSAGE_TYPE.JoinResponseOk,
      crdtType: "loro",
      roomId: "room-1",
      permission: "write",
      receiverVersion: version.encode(),
      metadata: new Uint8Array(0),
    }

    const result = fromProtocolMessage(msg, ctx)

    expect(result).not.toBeNull()
    expect(result?.docId).toBe("room-1")
    expect(result?.channelMsg.type).toBe("channel/sync-response")
  })

  it("translates DocUpdate to sync-response", () => {
    const ctx = createTranslationContext()

    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "loro",
      roomId: "room-1",
      updates: [new Uint8Array([1, 2, 3])],
    }

    const result = fromProtocolMessage(msg, ctx)

    expect(result).not.toBeNull()
    expect(result?.docId).toBe("room-1")
    expect(result?.channelMsg.type).toBe("channel/sync-response")
    const syncResponse = result?.channelMsg as ChannelMsgSyncResponse
    expect(syncResponse.transmission.type).toBe("update")
  })

  it("translates ephemeral DocUpdate to ephemeral message", () => {
    const ctx = createTranslationContext()

    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "ephemeral",
      roomId: "room-1",
      updates: [new Uint8Array([1, 2, 3])],
    }

    const result = fromProtocolMessage(msg, ctx)

    expect(result).not.toBeNull()
    expect(result?.channelMsg.type).toBe("channel/ephemeral")
    const ephemeral = result?.channelMsg as ChannelMsgEphemeral
    // New format uses stores array
    expect(ephemeral.stores).toHaveLength(1)
    expect(ephemeral.stores[0].data).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("returns null for empty DocUpdate", () => {
    const ctx = createTranslationContext()

    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "loro",
      roomId: "room-1",
      updates: [],
    }

    const result = fromProtocolMessage(msg, ctx)
    expect(result).toBeNull()
  })

  it("returns null for error messages", () => {
    const ctx = createTranslationContext()

    const joinError = {
      type: MESSAGE_TYPE.JoinError,
      crdtType: "loro" as const,
      roomId: "room-1",
      code: 0x00 as const,
      message: "Error",
    }

    expect(fromProtocolMessage(joinError as any, ctx)).toBeNull()

    const updateError = {
      type: MESSAGE_TYPE.UpdateError,
      crdtType: "loro" as const,
      roomId: "room-1",
      code: 0x00 as const,
      message: "Error",
    }

    expect(fromProtocolMessage(updateError as any, ctx)).toBeNull()

    const leave = {
      type: MESSAGE_TYPE.Leave,
      crdtType: "loro" as const,
      roomId: "room-1",
    }

    expect(fromProtocolMessage(leave as any, ctx)).toBeNull()
  })
})

describe("translateEstablishRequest", () => {
  it("creates JoinRequests for specified docs", () => {
    const msg: ChannelMsgEstablishRequest = {
      type: "channel/establish-request",
      identity: { peerId: "peer-1" as any, name: "Test", type: "user" },
    }

    const docIds = ["doc-1", "doc-2"]
    const getVersion = () => createEmptyVersion()

    const result = translateEstablishRequest(msg, docIds, getVersion)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe(MESSAGE_TYPE.JoinRequest)
    expect(result[0].roomId).toBe("doc-1")
    expect(result[1].roomId).toBe("doc-2")
  })

  it("uses provided version function", () => {
    const msg: ChannelMsgEstablishRequest = {
      type: "channel/establish-request",
      identity: { peerId: "peer-1" as any, name: "Test", type: "user" },
    }

    const docIds = ["doc-1"]
    const version = createEmptyVersion()
    const getVersion = () => version

    const result = translateEstablishRequest(msg, docIds, getVersion)

    expect(result[0].requesterVersion).toEqual(version.encode())
  })
})

describe("translateJoinResponse", () => {
  it("creates establish-response and sync-response", () => {
    const version = createEmptyVersion()

    const msg: JoinResponseOk = {
      type: MESSAGE_TYPE.JoinResponseOk,
      crdtType: "loro",
      roomId: "room-1",
      permission: "write",
      receiverVersion: version.encode(),
      metadata: new Uint8Array(0),
    }

    const identity = {
      peerId: "1" as const,
      name: "Test",
      type: "user" as const,
    }

    const result = translateJoinResponse(msg, identity)

    expect(result.establishResponse.type).toBe("channel/establish-response")
    expect(result.establishResponse.identity).toEqual(identity)
    expect(result.syncResponse).toBeDefined()
    expect(result.syncResponse?.type).toBe("channel/sync-response")
    expect(result.syncResponse?.docId).toBe("room-1")
  })
})
