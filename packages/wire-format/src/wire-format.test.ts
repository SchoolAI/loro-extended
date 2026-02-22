/**
 * Wire format encoding/decoding tests.
 *
 * Tests cover:
 * - Round-trip encoding/decoding for all 12 ChannelMsg types
 * - Frame header structure (6 bytes, version 2)
 * - Large payload handling (>64KB regression test)
 * - Error handling (DecodeError)
 * - Buffer subclass compatibility (Bun/Node.js)
 */

import type {
  ChannelMsg,
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
  PeerID,
} from "@loro-extended/repo"
import { LoroDoc, type VersionVector } from "loro-crdt"
import { describe, expect, it } from "vitest"
import {
  DecodeError,
  decode,
  decodeFrame,
  encode,
  encodeBatchFrame,
  encodeFrame,
  fromWireFormat,
  HEADER_SIZE,
  MessageType,
  toWireFormat,
  WIRE_VERSION,
  WireFlags,
} from "./index.js"

/**
 * Create a fresh VersionVector from a new document.
 */
function createVersion(): VersionVector {
  const doc = new LoroDoc()
  return doc.version()
}

/**
 * Compare two VersionVectors by their encoded representation.
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
          peerId: "peer-123" as PeerID,
          name: "Test User",
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
          peerId: "server-456" as PeerID,
          name: "Server",
          type: "service",
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.EstablishResponse)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip sync-request with ephemeral", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "doc-abc",
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
      expect(result.ephemeral).toHaveLength(1)
      expect(result.ephemeral?.[0].peerId).toBe("peer-1")
      expect(result.ephemeral?.[0].namespace).toBe("presence")
    })

    it("should round-trip sync-request without ephemeral", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "doc-xyz",
        requesterDocVersion: version,
        bidirectional: false,
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncRequest
      expect(result.ephemeral).toBeUndefined()
    })

    it("should round-trip sync-response with snapshot", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-snapshot",
        transmission: {
          type: "snapshot",
          data: new Uint8Array([10, 20, 30, 40]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.SyncResponse)

      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("snapshot")
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data).toEqual(
          new Uint8Array([10, 20, 30, 40]),
        )
      }
    })

    it("should round-trip sync-response with update", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-update",
        transmission: {
          type: "update",
          data: new Uint8Array([50, 60]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("update")
    })

    it("should round-trip sync-response with up-to-date", () => {
      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-uptodate",
        transmission: {
          type: "up-to-date",
          version,
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("up-to-date")
    })

    it("should round-trip sync-response with unavailable", () => {
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "doc-unavailable",
        transmission: {
          type: "unavailable",
        },
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire) as ChannelMsgSyncResponse
      expect(result.transmission.type).toBe("unavailable")
    })

    it("should round-trip update", () => {
      const version = createVersion()
      const msg: ChannelMsgUpdate = {
        type: "channel/update",
        docId: "doc-push",
        transmission: {
          type: "update",
          data: new Uint8Array([1, 2, 3]),
          version,
        },
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Update)

      const result = fromWireFormat(wire) as ChannelMsgUpdate
      expect(result.type).toBe("channel/update")
    })

    it("should round-trip directory-request with docIds", () => {
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
      const result = fromWireFormat(wire) as ChannelMsgDirectoryRequest
      expect(result.docIds).toBeUndefined()
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

    it("should round-trip delete-response with deleted", () => {
      const msg: ChannelMsgDeleteResponse = {
        type: "channel/delete-response",
        docId: "deleted-doc",
        status: "deleted",
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.DeleteResponse)

      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip delete-response with ignored", () => {
      const msg: ChannelMsgDeleteResponse = {
        type: "channel/delete-response",
        docId: "ignored-doc",
        status: "ignored",
      }

      const wire = toWireFormat(msg)
      const result = fromWireFormat(wire)
      expect(result).toEqual(msg)
    })

    it("should round-trip ephemeral", () => {
      const msg: ChannelMsgEphemeral = {
        type: "channel/ephemeral",
        docId: "room-123",
        hopsRemaining: 3,
        stores: [
          {
            peerId: "peer-a" as PeerID,
            data: new Uint8Array([100, 101, 102]),
            namespace: "cursors",
          },
          {
            peerId: "peer-b" as PeerID,
            data: new Uint8Array([200, 201]),
            namespace: "awareness",
          },
        ],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Ephemeral)

      const result = fromWireFormat(wire) as ChannelMsgEphemeral
      expect(result.type).toBe("channel/ephemeral")
      expect(result.docId).toBe("room-123")
      expect(result.hopsRemaining).toBe(3)
      expect(result.stores).toHaveLength(2)
      expect(result.stores[0].namespace).toBe("cursors")
      expect(result.stores[1].namespace).toBe("awareness")
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
            type: "channel/directory-request",
            docIds: ["doc-a"],
          },
        ],
      }

      const wire = toWireFormat(msg)
      expect(wire.t).toBe(MessageType.Batch)

      const result = fromWireFormat(wire) as ChannelMsgBatch
      expect(result.type).toBe("channel/batch")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].type).toBe("channel/sync-request")
      expect(result.messages[1].type).toBe("channel/directory-request")
    })
  })

  describe("encode / decode (CBOR without frame)", () => {
    it("should encode and decode a message", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "test-peer" as PeerID,
          name: "Test",
          type: "user",
        },
      }

      const encoded = encode(msg)
      expect(encoded).toBeInstanceOf(Uint8Array)
      expect(encoded.length).toBeGreaterThan(0)

      const decoded = decode(encoded)
      expect(decoded).toEqual(msg)
    })
  })

  describe("encodeFrame / decodeFrame", () => {
    it("should encode and decode a single message frame", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "peer-frame" as PeerID,
          name: "Frame Test",
          type: "bot",
        },
      }

      const frame = encodeFrame(msg)

      // Check header structure (6 bytes)
      expect(frame[0]).toBe(WIRE_VERSION)
      expect(frame[1]).toBe(WireFlags.NONE)

      // Check that frame is longer than header
      expect(frame.length).toBeGreaterThan(HEADER_SIZE)

      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(1)
      expect(decoded[0]).toEqual(msg)
    })

    it("should encode and decode a batch frame", () => {
      const version = createVersion()
      const msgs: ChannelMsg[] = [
        {
          type: "channel/sync-request",
          docId: "batch-doc-1",
          requesterDocVersion: version,
          bidirectional: true,
        },
        {
          type: "channel/directory-request",
          docIds: ["batch-doc-2"],
        },
      ]

      const frame = encodeBatchFrame(msgs)

      // Check header
      expect(frame[0]).toBe(WIRE_VERSION)
      expect(frame[1]).toBe(WireFlags.BATCH)

      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(2)
      expect(decoded[0].type).toBe("channel/sync-request")
      expect(decoded[1].type).toBe("channel/directory-request")
    })

    it("should have 6-byte header with Uint32 payload length", () => {
      const msg: ChannelMsgDirectoryResponse = {
        type: "channel/directory-response",
        docIds: ["test"],
      }

      const frame = encodeFrame(msg)
      expect(frame.length).toBeGreaterThan(HEADER_SIZE)

      // Extract payload length from header (bytes 2-5, big-endian Uint32)
      const view = new DataView(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      )
      const payloadLength = view.getUint32(2, false)

      expect(payloadLength).toBe(frame.length - HEADER_SIZE)
    })
  })

  describe("Large payload handling (>64KB regression test)", () => {
    it("should handle payloads larger than 64KB", () => {
      // Create a 100KB payload - this would fail with the old Uint16 header
      const largeData = new Uint8Array(100 * 1024)
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

      // Verify the frame is larger than 64KB (plus header overhead)
      expect(frame.length).toBeGreaterThan(64 * 1024)

      // Verify payload length is correctly encoded
      const view = new DataView(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      )
      const payloadLength = view.getUint32(2, false)
      expect(payloadLength).toBe(frame.length - HEADER_SIZE)

      // Verify round-trip works
      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(1)

      const result = decoded[0] as ChannelMsgSyncResponse
      expect(result.type).toBe("channel/sync-response")
      expect(result.docId).toBe("large-doc")
      expect(result.transmission.type).toBe("snapshot")
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data.length).toBe(100 * 1024)
        // Verify data integrity
        for (let i = 0; i < 100; i++) {
          expect(result.transmission.data[i]).toBe(i % 256)
        }
      }
    })

    it("should handle 1MB payload", () => {
      // Create a 1MB payload
      const megabyte = 1024 * 1024
      const largeData = new Uint8Array(megabyte)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "megabyte-doc",
        transmission: {
          type: "snapshot",
          data: largeData,
          version,
        },
      }

      const frame = encodeFrame(msg)
      expect(frame.length).toBeGreaterThan(megabyte)

      const decoded = decodeFrame(frame)
      const result = decoded[0] as ChannelMsgSyncResponse
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data.length).toBe(megabyte)
      }
    })

    it("should handle payloads at exact 64KB boundary", () => {
      // Test the exact boundary that would overflow with Uint16
      const boundarySize = 65535 // Max Uint16 value
      const largeData = new Uint8Array(boundarySize)

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "boundary-doc",
        transmission: {
          type: "snapshot",
          data: largeData,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      const result = decoded[0] as ChannelMsgSyncResponse
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data.length).toBe(boundarySize)
      }
    })

    it("should handle payloads just over 64KB boundary", () => {
      // Test just over the boundary that would wrap with Uint16
      const overBoundarySize = 65536 // Would wrap to 0 with Uint16
      const largeData = new Uint8Array(overBoundarySize)

      const version = createVersion()
      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "over-boundary-doc",
        transmission: {
          type: "snapshot",
          data: largeData,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      const result = decoded[0] as ChannelMsgSyncResponse
      if (result.transmission.type === "snapshot") {
        expect(result.transmission.data.length).toBe(overBoundarySize)
      }
    })
  })

  describe("DecodeError handling", () => {
    it("should throw DecodeError on unsupported version", () => {
      // Create a frame with version 99
      const frame = new Uint8Array([99, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5])

      expect(() => decodeFrame(frame)).toThrow(DecodeError)
      try {
        decodeFrame(frame)
      } catch (error) {
        expect(error).toBeInstanceOf(DecodeError)
        expect((error as DecodeError).code).toBe("unsupported_version")
      }
    })

    it("should throw DecodeError on truncated frame (missing header)", () => {
      const frame = new Uint8Array([WIRE_VERSION, 0, 0]) // Only 3 bytes

      expect(() => decodeFrame(frame)).toThrow(DecodeError)
      try {
        decodeFrame(frame)
      } catch (error) {
        expect(error).toBeInstanceOf(DecodeError)
        expect((error as DecodeError).code).toBe("truncated_frame")
      }
    })

    it("should throw DecodeError on truncated frame (missing payload)", () => {
      // Header says 100 bytes payload but frame is too short
      const frame = new Uint8Array([WIRE_VERSION, 0, 0, 0, 0, 100])

      expect(() => decodeFrame(frame)).toThrow(DecodeError)
      try {
        decodeFrame(frame)
      } catch (error) {
        expect(error).toBeInstanceOf(DecodeError)
        expect((error as DecodeError).code).toBe("truncated_frame")
      }
    })

    it("should throw DecodeError on invalid CBOR", () => {
      // Valid header but garbage CBOR
      const frame = new Uint8Array([
        WIRE_VERSION,
        0,
        0,
        0,
        0,
        3,
        0xff,
        0xff,
        0xff,
      ])

      expect(() => decodeFrame(frame)).toThrow(DecodeError)
      try {
        decodeFrame(frame)
      } catch (error) {
        expect(error).toBeInstanceOf(DecodeError)
        expect((error as DecodeError).code).toBe("invalid_cbor")
      }
    })

    it("should include cause in DecodeError for CBOR errors", () => {
      const frame = new Uint8Array([
        WIRE_VERSION,
        0,
        0,
        0,
        0,
        3,
        0xff,
        0xff,
        0xff,
      ])

      try {
        decodeFrame(frame)
      } catch (error) {
        expect(error).toBeInstanceOf(DecodeError)
        expect((error as DecodeError).cause).toBeDefined()
      }
    })
  })

  describe("Buffer subclass handling (Bun/Node.js compatibility)", () => {
    it("should decode frames passed as Buffer-like subclass", () => {
      const msg: ChannelMsgDirectoryResponse = {
        type: "channel/directory-response",
        docIds: ["buffer-test"],
      }

      const frame = encodeFrame(msg)

      // Simulate a Buffer by creating a Uint8Array subclass
      class FakeBuffer extends Uint8Array {
        constructor(data: Uint8Array) {
          super(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
        }
      }

      const bufferFrame = new FakeBuffer(frame)

      // This should work despite being a subclass
      const decoded = decodeFrame(bufferFrame)
      expect(decoded).toHaveLength(1)
      expect(decoded[0]).toEqual(msg)
    })
  })

  describe("MessageType constants", () => {
    it("should have unique values for all message types", () => {
      const values = Object.values(MessageType)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)
    })
  })

  describe("VersionVector preservation", () => {
    it("should preserve VersionVector with actual document changes", () => {
      const doc = new LoroDoc()
      doc.getText("content").insert(0, "Hello, world!")
      doc.commit()

      const version = doc.version()

      const msg: ChannelMsgSyncRequest = {
        type: "channel/sync-request",
        docId: "version-test",
        requesterDocVersion: version,
        bidirectional: true,
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      const result = decoded[0] as ChannelMsgSyncRequest
      expect(versionsEqual(result.requesterDocVersion, version)).toBe(true)
    })

    it("should preserve VersionVector in transmission", () => {
      const doc = new LoroDoc()
      doc.getMap("data").set("key", "value")
      doc.commit()

      const version = doc.version()
      const snapshot = doc.export({ mode: "snapshot" })

      const msg: ChannelMsgSyncResponse = {
        type: "channel/sync-response",
        docId: "transmission-test",
        transmission: {
          type: "snapshot",
          data: snapshot,
          version,
        },
      }

      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)

      const result = decoded[0] as ChannelMsgSyncResponse
      if (result.transmission.type === "snapshot") {
        expect(versionsEqual(result.transmission.version, version)).toBe(true)
      }
    })
  })

  describe("All message types coverage (parameterized)", () => {
    const version = createVersion()

    const testCases: [string, ChannelMsg][] = [
      [
        "establish-request",
        {
          type: "channel/establish-request",
          identity: { peerId: "p1" as PeerID, name: "User", type: "user" },
        },
      ],
      [
        "establish-response",
        {
          type: "channel/establish-response",
          identity: { peerId: "p2" as PeerID, name: "Server", type: "service" },
        },
      ],
      [
        "sync-request",
        {
          type: "channel/sync-request",
          docId: "doc",
          requesterDocVersion: version,
          bidirectional: true,
        },
      ],
      [
        "sync-response (snapshot)",
        {
          type: "channel/sync-response",
          docId: "doc",
          transmission: {
            type: "snapshot",
            data: new Uint8Array([1]),
            version,
          },
        },
      ],
      [
        "sync-response (update)",
        {
          type: "channel/sync-response",
          docId: "doc",
          transmission: { type: "update", data: new Uint8Array([2]), version },
        },
      ],
      [
        "sync-response (up-to-date)",
        {
          type: "channel/sync-response",
          docId: "doc",
          transmission: { type: "up-to-date", version },
        },
      ],
      [
        "sync-response (unavailable)",
        {
          type: "channel/sync-response",
          docId: "doc",
          transmission: { type: "unavailable" },
        },
      ],
      [
        "update",
        {
          type: "channel/update",
          docId: "doc",
          transmission: { type: "update", data: new Uint8Array([3]), version },
        },
      ],
      [
        "directory-request",
        { type: "channel/directory-request", docIds: ["a"] },
      ],
      [
        "directory-response",
        { type: "channel/directory-response", docIds: ["b"] },
      ],
      ["new-doc", { type: "channel/new-doc", docIds: ["c"] }],
      ["delete-request", { type: "channel/delete-request", docId: "d" }],
      [
        "delete-response",
        { type: "channel/delete-response", docId: "d", status: "deleted" },
      ],
      [
        "ephemeral",
        {
          type: "channel/ephemeral",
          docId: "room",
          hopsRemaining: 2,
          stores: [
            {
              peerId: "p" as PeerID,
              data: new Uint8Array([4]),
              namespace: "ns",
            },
          ],
        },
      ],
      [
        "batch",
        {
          type: "channel/batch",
          messages: [{ type: "channel/directory-request" }],
        },
      ],
    ]

    it.each(
      testCases,
    )("should round-trip %s through encodeFrame/decodeFrame", (_, msg) => {
      const frame = encodeFrame(msg)
      const decoded = decodeFrame(frame)
      expect(decoded).toHaveLength(1)
      expect(decoded[0].type).toBe(msg.type)
    })
  })
})
