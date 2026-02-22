/**
 * Tests for the framework-agnostic HTTP polling POST handler.
 */

import type {
  ChannelMsg,
  ChannelMsgEstablishRequest,
  PeerID,
} from "@loro-extended/repo"
import {
  encodeFrame,
  FragmentReassembler,
  fragmentPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"
import { VersionVector } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parsePostBody } from "../polling-handler.js"

describe("parsePostBody", () => {
  let reassembler: FragmentReassembler

  beforeEach(() => {
    reassembler = new FragmentReassembler({
      timeoutMs: 10000,
    })
  })

  afterEach(() => {
    reassembler.dispose()
  })

  describe("Complete messages", () => {
    it("should decode a complete message and return messages result", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
        docIds: ["doc-1", "doc-2"],
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      const result = parsePostBody(reassembler, wrapped)

      expect(result.type).toBe("messages")
      expect(result.response.status).toBe(200)
      expect(result.response.body).toEqual({ ok: true })

      if (result.type === "messages") {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].type).toBe("channel/directory-request")
        expect((result.messages[0] as any).docIds).toEqual(["doc-1", "doc-2"])
      }
    })

    it("should decode sync-request with VersionVector", () => {
      const msg: ChannelMsg = {
        type: "channel/sync-request",
        docId: "test-doc",
        requesterDocVersion: new VersionVector(null),
        bidirectional: true,
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      const result = parsePostBody(reassembler, wrapped)

      expect(result.type).toBe("messages")
      if (result.type === "messages") {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].type).toBe("channel/sync-request")
      }
    })

    it("should decode establish-request", () => {
      const msg: ChannelMsgEstablishRequest = {
        type: "channel/establish-request",
        identity: {
          peerId: "1234567890" as PeerID,
          name: "Test Peer",
          type: "user",
        },
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      const result = parsePostBody(reassembler, wrapped)

      expect(result.type).toBe("messages")
      if (result.type === "messages") {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].type).toBe("channel/establish-request")
        const decoded = result.messages[0] as ChannelMsgEstablishRequest
        expect(decoded.identity.peerId).toBe("1234567890")
        expect(decoded.identity.name).toBe("Test Peer")
        expect(decoded.identity.type).toBe("user")
      }
    })
  })

  describe("Fragment handling", () => {
    it("should return pending for fragment header", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
        docIds: ["doc-1"],
      }
      const frame = encodeFrame(msg)
      // Use a small max size to force fragmentation
      const fragments = fragmentPayload(frame, 10)

      // Send just the header
      const result = parsePostBody(reassembler, fragments[0])

      expect(result.type).toBe("pending")
      expect(result.response.status).toBe(202)
      expect(result.response.body).toEqual({ pending: true })
    })

    it("should return pending for partial fragments", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
        docIds: ["doc-1", "doc-2", "doc-3"],
      }
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 10)

      // Send header
      parsePostBody(reassembler, fragments[0])

      // Send first data fragment (not all)
      const result = parsePostBody(reassembler, fragments[1])

      expect(result.type).toBe("pending")
      expect(result.response.status).toBe(202)
    })

    it("should return complete message after all fragments received", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
        docIds: ["doc-1", "doc-2"],
      }
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 10)

      // Send all fragments
      let lastResult: ReturnType<typeof parsePostBody> | undefined
      for (const fragment of fragments) {
        lastResult = parsePostBody(reassembler, fragment)
      }

      expect(lastResult?.type).toBe("messages")
      expect(lastResult?.response.status).toBe(200)
      if (lastResult?.type === "messages") {
        expect(lastResult.messages).toHaveLength(1)
        expect(lastResult.messages[0].type).toBe("channel/directory-request")
      }
    })

    it("should handle fragments arriving out of order", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-response",
        docIds: ["a", "b", "c", "d", "e"],
      }
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 10)

      // Send header first
      parsePostBody(reassembler, fragments[0])

      // Send data fragments in reverse order (except header)
      for (let i = fragments.length - 1; i >= 1; i--) {
        const result = parsePostBody(reassembler, fragments[i])

        if (i === 1) {
          // Last fragment to arrive completes the batch
          expect(result.type).toBe("messages")
        } else {
          expect(result.type).toBe("pending")
        }
      }
    })
  })

  describe("Error handling", () => {
    it("should return error for invalid data", () => {
      const invalidData = new Uint8Array([0x00, 0xff, 0xff, 0xff])

      const result = parsePostBody(reassembler, invalidData)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)
      expect((result.response.body as any).error).toBeDefined()
    })

    it("should return error for unknown prefix", () => {
      const unknownPrefix = new Uint8Array([0x99, 0x01, 0x02, 0x03])

      const result = parsePostBody(reassembler, unknownPrefix)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)
    })

    it("should return error for empty data", () => {
      const emptyData = new Uint8Array([])

      const result = parsePostBody(reassembler, emptyData)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)
    })

    it("should return error for truncated frame", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      // Truncate the data
      const truncated = wrapped.slice(0, 5)

      const result = parsePostBody(reassembler, truncated)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)
    })
  })

  describe("Multiple batches", () => {
    it("should handle interleaved complete messages and fragments", () => {
      // Start a fragmented message
      const largeMsg: ChannelMsg = {
        type: "channel/directory-response",
        docIds: ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5"],
      }
      const largeFrame = encodeFrame(largeMsg)
      const fragments = fragmentPayload(largeFrame, 15)

      // Send header
      parsePostBody(reassembler, fragments[0])

      // Send a complete message in the middle
      const smallMsg: ChannelMsg = {
        type: "channel/directory-request",
      }
      const smallFrame = encodeFrame(smallMsg)
      const wrapped = wrapCompleteMessage(smallFrame)

      const completeResult = parsePostBody(reassembler, wrapped)
      expect(completeResult.type).toBe("messages")
      if (completeResult.type === "messages") {
        expect(completeResult.messages[0].type).toBe(
          "channel/directory-request",
        )
      }

      // Continue with fragments
      let lastResult: ReturnType<typeof parsePostBody> | undefined
      for (let i = 1; i < fragments.length; i++) {
        lastResult = parsePostBody(reassembler, fragments[i])
      }

      expect(lastResult?.type).toBe("messages")
      if (lastResult?.type === "messages") {
        expect(lastResult.messages[0].type).toBe("channel/directory-response")
      }
    })
  })

  describe("Response format", () => {
    it("should return correct response format for success", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      const result = parsePostBody(reassembler, wrapped)

      expect(result.response).toEqual({
        status: 200,
        body: { ok: true },
      })
    })

    it("should return correct response format for pending", () => {
      const msg: ChannelMsg = {
        type: "channel/directory-request",
        docIds: ["doc-1"],
      }
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 10)

      const result = parsePostBody(reassembler, fragments[0])

      expect(result.response).toEqual({
        status: 202,
        body: { pending: true },
      })
    })

    it("should return correct response format for error", () => {
      const invalidData = new Uint8Array([0x99])

      const result = parsePostBody(reassembler, invalidData)

      expect(result.response.status).toBe(400)
      expect((result.response.body as any).error).toBeDefined()
    })
  })
})
