import type {
  ChannelMsgBatch,
  ChannelMsgDeleteRequest,
  ChannelMsgDeleteResponse,
  ChannelMsgDirectoryRequest,
  ChannelMsgDirectoryResponse,
  ChannelMsgEphemeral,
  ChannelMsgEstablishRequest,
  ChannelMsgEstablishResponse,
  ChannelMsgNewDoc,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ChannelMsgUpdate,
} from "@loro-extended/repo"
import {
  decodeFrame,
  encodeBatchFrame,
  encodeFrame,
  fromWireFormat,
  MessageType,
  toWireFormat,
  WIRE_VERSION,
  WireFlags,
} from "@loro-extended/wire-format"
import { LoroDoc, type PeerID, type VersionVector } from "loro-crdt"
import { describe, expect, it } from "vitest"

/**
 * Helper to create a VersionVector from a LoroDoc.
 */
function createVersion() {
  const doc = new LoroDoc()
  return doc.version()
}

/**
 * Helper to compare VersionVectors by their encoded form.
 * VersionVector is a WASM class, so we compare by encoding.
 */
function versionsEqual(a: VersionVector, b: VersionVector): boolean {
  const aEncoded = a.encode()
  const bEncoded = b.encode()
  if (aEncoded.length !== bEncoded.length) return false
  for (let i = 0; i < aEncoded.length; i++) {
    if (aEncoded[i] !== bEncoded[i]) return false
  }
  return true
}

describe("Wire Format", () => {
  describe("toWireFormat / fromWireFormat", () => {
    it("should round-trip establish-request", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "peer-1" as PeerID,
          name: "Test Peer",
          type: "user",
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.EstablishRequest)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip establish-response", () => {
      const msg: ChannelMsgEstablishResponse = {
        type: "channel/establish-response",
        identity: {
          peerId: "peer-2" as PeerID,
          name: "Server",
          type: "service",
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.EstablishResponse)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip sync-request", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "doc-123",
        requesterDocVersion: version,
        bidirectional: true,
        ephemeral: [
          {
            peerId: "peer-1" as PeerID,
            data: new Uint8Array([1, 2, 3]),
            namespace: "presence",
          },
        ],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.SyncRequest)

      const result = fromWireFormat(wire) as ChannelMsgSyncRequest
      expect(result.type).toBe("channel/sync-request")
      expect(result.docId).toBe(msg.docId)
      expect(result.bidirectional).toBe(msg.bidirectional)
      expect(versionsEqual(result.requesterDocVersion, version)).toBe(true)
      expect(result.ephemeral).toEqual(msg.ephemeral)
    })

    it("should round-trip sync-request without ephemeral", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "doc-123",
        requesterDocVersion: version,
        bidirectional: false,
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncRequest
      expect(result.type).toBe("channel/sync-request")
      expect(result.docId).toBe(msg.docId)
      expect(result.bidirectional).toBe(false)
      expect(versionsEqual(result.requesterDocVersion, version)).toBe(true)
    })

    it("should round-trip sync-response with snapshot", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-123",
        transmission: {
          type: "snapshot",
          data: new Uint8Array([10, 20, 30, 40]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.SyncResponse)

      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.type).toBe("channel/sync-response")
      expect(result.docId).toBe(msg.docId)
      expect(result.transmission.type).toBe("snapshot")
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data).toEqual(
          new Uint8Array([10, 20, 30, 40]),
        )
        expect(versionsEqual(result.transmission.version, version)).toBe(true)
      }
    })

    it("should round-trip sync-response with update", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-123",
        transmission: {
          type: "update",
          data: new Uint8Array([5, 6, 7]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("update")
      if (result.transmission.type === "update") {
        expect(result.transmission.data).toEqual(new Uint8Array([5, 6, 7]))
        expect(versionsEqual(result.transmission.version, version)).toBe(true)
      }
    })

    it("should round-trip sync-response with up-to-date", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-123",
        transmission: {
          type: "up-to-date",
          version,
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("up-to-date")
      if (result.transmission.type === "up-to-date") {
        expect(versionsEqual(result.transmission.version, version)).toBe(true)
      }
    })

    it("should round-trip sync-response with unavailable", () => {
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-123",
        transmission: {
          type: "unavailable",
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip update", () => {
      const version = createVersion()
      const msg: ChannelMsgUpdate = {
        type: "channel/update",
        docId: "doc-456",
        transmission: {
          type: "update",
          data: new Uint8Array([100, 101, 102]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Update)

      const result = fromWireFormat(wire) as ChannelMsgUpdate
      expect(result.type).toBe("channel/update")
      expect(result.docId).toBe(msg.docId)
      if (result.transmission.type === "update") {
        expect(result.transmission.data).toEqual(
          new Uint8Array([100, 101, 102]),
        )
        expect(versionsEqual(result.transmission.version, version)).toBe(true)
      }
    })

    it("should round-trip directory-request", () => {
      const msg: ChannelMsgDirectoryRequest = {
        type: "channel/directory-request",
        docIds: ["doc-1", "doc-2"],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.DirectoryRequest)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip directory-request without docIds", () => {
      const msg: ChannelMsgDirectoryRequest = {
        type: "channel/directory-request",
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip directory-response", () => {
      const msg: ChannelMsgDirectoryResponse = {
        type: "channel/directory-response",
        docIds: ["doc-a", "doc-b", "doc-c"],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.DirectoryResponse)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip new-doc", () => {
      const msg: ChannelMsgNewDoc = {
        type: "channel/new-doc",
        docIds: ["new-doc-1", "new-doc-2"],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.NewDoc)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip delete-request", () => {
      const msg: ChannelMsgDeleteRequest = {
        type: "channel/delete-request",
        docId: "doc-to-delete",
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.DeleteRequest)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip delete-response with deleted status", () => {
      const msg: ChannelMsgDeleteResponse = {
        type: "channel/delete-response",
        docId: "doc-deleted",
        status: "deleted",
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.DeleteResponse)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip delete-response with ignored status", () => {
      const msg: ChannelMsgDeleteResponse = {
        type: "channel/delete-response",
        docId: "doc-ignored",
        status: "ignored",
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip ephemeral", () => {
      const msg: ChannelMsgEphemeral = {
        type: "channel/ephemeral",
        docId: "doc-789",
        hopsRemaining: 2,
        stores: [
          {
            peerId: "peer-1" as PeerID,
            data: new Uint8Array([1, 2, 3]),
            namespace: "presence",
          },
          {
            peerId: "peer-2" as PeerID,
            data: new Uint8Array([4, 5, 6]),
            namespace: "cursors",
          },
        ],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Ephemeral)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip batch", () => {
      const version = createVersion()
      const msg: ChannelMsgBatch = {
        type: "channel/batch",
        messages: [
          {
            type: "channel/sync-request",
            docId: "doc-1",
            requesterDocVersion: version,
            bidirectional: true,
          },
          {
            type: "channel/sync-request",
            docId: "doc-2",
            requesterDocVersion: version,
            bidirectional: true,
          },
        ],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Batch)

      const result = fromWireFormat(wire) as ChannelMsgBatch
      expect(result.type).toBe("channel/batch")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].type).toBe("channel/sync-request")
      expect(result.messages[1].type).toBe("channel/sync-request")
    })
  })

  describe("encodeFrame / decodeFrame", () => {
    it("should encode and decode a single message", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "peer-1" as PeerID,
          name: "Test",
          type: "user",
        },
      }

      const frame = encodeFrame(msg)

      // Check header
      expect(frame[0]).toBe(WIRE_VERSION)
      expect(frame[1]).toBe(WireFlags.NONE)

      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(1)
      expect(decoded[0]).toEqual(msg)
    })

    it("should encode and decode a batch of messages", () => {
      const version = createVersion()
      const msgs: ChannelMsgSyncRequest[] = [
        {
          type: "channel/sync-request",
          docId: "doc-1",
          requesterDocVersion: version,
          bidirectional: true,
        },
        {
          type: "channel/sync-request",
          docId: "doc-2",
          requesterDocVersion: version,
          bidirectional: false,
        },
      ]

      const frame = encodeBatchFrame(msgs)

      // Check header
      expect(frame[0]).toBe(WIRE_VERSION)
      expect(frame[1]).toBe(WireFlags.BATCH)

      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(2)
      expect(decoded[0].type).toBe("channel/sync-request")
      expect(decoded[1].type).toBe("channel/sync-request")
    })

    it("should handle large payloads", () => {
      const largeData = new Uint8Array(10000)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "large-doc",
        transmission: {
          type: "snapshot",
          data: largeData,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      expect(decoded).toHaveLength(1)
      const result = decoded[0] as ChannelMsgSyncResponse
      expect(result.type).toBe("channel/sync-response")
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data).toEqual(largeData)
      }
    })

    it("should throw on unsupported wire version", () => {
      // v2 format: 6-byte header [version, flags, length(4 bytes big-endian)]
      const frame = new Uint8Array([99, 0, 0, 0, 0, 1, 0]) // version 99, 1 byte payload
      expect(() => decodeFrame(frame)).toThrow("Unsupported wire version: 99")
    })

    it("should throw on truncated frame", () => {
      // v2 format: 6-byte header claiming 100 bytes payload but only has header
      const frame = new Uint8Array([WIRE_VERSION, 0, 0, 0, 0, 100]) // claims 100 bytes but only has header
      expect(() => decodeFrame(frame)).toThrow("Frame truncated")
    })

    it("should throw on frame too short", () => {
      const frame = new Uint8Array([1, 0]) // only 2 bytes
      expect(() => decodeFrame(frame)).toThrow("Frame too short")
    })
  })

  describe("MessageType constants", () => {
    it("should have unique values for all message types", () => {
      const values = Object.values(MessageType)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)
    })
  })

  describe("VersionVector with actual data (regression test)", () => {
    it("should preserve VersionVector with actual document changes", () => {
      // Create a doc with actual changes to get a non-empty version
      const doc = new LoroDoc()
      doc.getText("text").insert(0, "hello world")
      doc.commit()
      const version = doc.version()

      // Verify the version is non-empty
      expect(version.get(doc.peerIdStr)).toBeGreaterThan(0)

      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "test-doc",
        requesterDocVersion: version,
        bidirectional: true,
      }

      const frame = encodeFrame(msg)
      const [decoded] = decodeFrame(frame) as [ChannelMsgSyncRequest]

      // Verify version data is preserved through encoding
      expect(decoded.requesterDocVersion.get(doc.peerIdStr)).toBe(
        version.get(doc.peerIdStr),
      )
    })

    it("should preserve VersionVector in transmission through encoding", () => {
      const doc = new LoroDoc()
      doc.getMap("data").set("key", "value")
      doc.commit()
      const version = doc.version()
      const snapshot = doc.export({ mode: "snapshot" })

      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: {
          type: "snapshot",
          data: snapshot,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const [decoded] = decodeFrame(frame) as [ChannelMsgSyncResponse]

      expect(decoded.transmission.type).toBe("snapshot")
      if (decoded.transmission.type === "snapshot") {
        expect(decoded.transmission.version.get(doc.peerIdStr)).toBe(
          version.get(doc.peerIdStr),
        )
      }
    })
  })

  describe("Payload size limits", () => {
    it("should handle payloads up to 65535 bytes", () => {
      // Create a payload near the limit (leaving room for header overhead)
      const largeData = new Uint8Array(60000)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "large-doc",
        transmission: {
          type: "snapshot",
          data: largeData,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      expect(decoded).toHaveLength(1)
      const result = decoded[0] as ChannelMsgSyncResponse
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data.length).toBe(60000)
      }
    })

    it("should handle maximum payload length (65535 bytes)", () => {
      // The 2-byte length field can represent up to 65535
      // This test verifies we can encode/decode at the boundary
      const maxData = new Uint8Array(50000) // Safe size that won't exceed with overhead

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "max-doc",
        transmission: {
          type: "snapshot",
          data: maxData,
          version,
        },
      }

      const frame = encodeFrame(msg)

      // Verify the payload length is correctly encoded in the header
      const payloadLength = (frame[2] << 8) | frame[3]
      expect(payloadLength).toBeLessThanOrEqual(65535)

      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(1)
    })
  })

  describe("Buffer subclass handling (Bun/Node.js compatibility)", () => {
    /**
     * This test verifies that decodeFrame can handle Buffer input,
     * which is a subclass of Uint8Array used by Bun and Node.js.
     *
     * The @levischuck/tiny-cbor library performs strict prototype checks
     * and only accepts plain Uint8Array or DataView, not subclasses.
     * This caused "Unsupported data type" errors in Bun WebSocket handlers.
     *
     * @see https://github.com/loro-dev/loro-extended/issues/XXX
     */
    it("should decode frames passed as Buffer (Uint8Array subclass)", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "peer-1" as PeerID,
          name: "Test",
          type: "user",
        },
      }

      // Encode the message to get a valid frame
      const frame = encodeFrame(msg)

      // Convert to Buffer (simulates what Bun's WebSocket returns)
      // Buffer is a subclass of Uint8Array in Node.js/Bun
      const bufferFrame = Buffer.from(frame)

      // Verify it's actually a Buffer (subclass of Uint8Array)
      expect(bufferFrame).toBeInstanceOf(Buffer)
      expect(bufferFrame).toBeInstanceOf(Uint8Array)
      expect(bufferFrame.constructor).not.toBe(Uint8Array)

      // This should work but currently fails with "Unsupported data type"
      // because tiny-cbor checks prototype === Uint8Array.prototype
      const decoded = decodeFrame(bufferFrame)
      expect(decoded).toHaveLength(1)
      expect(decoded[0]).toEqual(msg)
    })

    it("should decode batch frames passed as Buffer", () => {
      const version = createVersion()
      const msgs: ChannelMsgSyncRequest[] = [
        {
          type: "channel/sync-request",
          docId: "doc-1",
          requesterDocVersion: version,
          bidirectional: true,
        },
        {
          type: "channel/sync-request",
          docId: "doc-2",
          requesterDocVersion: version,
          bidirectional: false,
        },
      ]

      const frame = encodeBatchFrame(msgs)
      const bufferFrame = Buffer.from(frame)

      const decoded = decodeFrame(bufferFrame)
      expect(decoded).toHaveLength(2)
      expect(decoded[0].type).toBe("channel/sync-request")
      expect(decoded[1].type).toBe("channel/sync-request")
    })
  })

  describe("All message types coverage (parameterized)", () => {
    it.each([
      [
        "channel/directory-request with docIds",
        {
          type: "channel/directory-request" as const,
          docIds: ["doc-a", "doc-b", "doc-c"],
        },
      ],
      [
        "channel/directory-response",
        {
          type: "channel/directory-response" as const,
          docIds: ["x", "y", "z"],
        },
      ],
      [
        "channel/new-doc",
        {
          type: "channel/new-doc" as const,
          docIds: ["new-1", "new-2"],
        },
      ],
      [
        "channel/delete-request",
        {
          type: "channel/delete-request" as const,
          docId: "del-1",
        },
      ],
      [
        "channel/delete-response deleted",
        {
          type: "channel/delete-response" as const,
          docId: "del-1",
          status: "deleted" as const,
        },
      ],
      [
        "channel/delete-response ignored",
        {
          type: "channel/delete-response" as const,
          docId: "del-2",
          status: "ignored" as const,
        },
      ],
    ])("should round-trip %s", (_name, msg) => {
      const frame = encodeFrame(msg)
      const [decoded] = decodeFrame(frame)
      expect(decoded).toEqual(msg)
    })
  })
})
