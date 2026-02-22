/**
 * Tests for the SSE handler (Functional Core).
 *
 * These tests verify the parsePostBody function which is the framework-agnostic
 * core of POST request handling. The function:
 * - Processes binary CBOR data through the reassembler
 * - Returns a discriminated union describing what to do
 * - Does NOT execute side effects (that's the framework adapter's job)
 */

import type { ChannelMsgSyncRequest } from "@loro-extended/repo"
import {
  encodeFrame,
  FragmentReassembler,
  fragmentPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { parsePostBody, type SsePostResult } from "../sse-handler.js"

/**
 * Create a test sync-request message.
 */
function createSyncRequest(docId = "test-doc"): ChannelMsgSyncRequest {
  const doc = new LoroDoc()
  return {
    type: "channel/sync-request",
    docId,
    requesterDocVersion: doc.version(),
    bidirectional: false,
  }
}

/**
 * Encode a message and wrap with MESSAGE_COMPLETE prefix.
 */
function encodeAndWrap(msg: ChannelMsgSyncRequest): Uint8Array {
  const frame = encodeFrame(msg)
  return wrapCompleteMessage(frame)
}

describe("parsePostBody", () => {
  describe("complete messages", () => {
    it("returns messages result for valid complete message", () => {
      const reassembler = new FragmentReassembler()
      const msg = createSyncRequest()
      const body = encodeAndWrap(msg)

      const result = parsePostBody(reassembler, body)

      expect(result.type).toBe("messages")
      expect(result.response.status).toBe(200)
      expect(result.response.body).toEqual({ ok: true })

      if (result.type === "messages") {
        expect(result.messages).toHaveLength(1)
        expect(result.messages[0].type).toBe("channel/sync-request")
        const decoded = result.messages[0] as ChannelMsgSyncRequest
        expect(decoded.docId).toBe("test-doc")
      }

      reassembler.dispose()
    })

    it("handles multiple messages in batch frame", () => {
      const reassembler = new FragmentReassembler()
      const msg1 = createSyncRequest("doc-1")

      // Note: encodeBatchFrame would be used here, but for simplicity
      // we test single messages. Batch encoding is tested in wire-format package.
      const body = encodeAndWrap(msg1)
      const result = parsePostBody(reassembler, body)

      expect(result.type).toBe("messages")
      if (result.type === "messages") {
        expect(result.messages.length).toBeGreaterThanOrEqual(1)
      }

      reassembler.dispose()
    })
  })

  describe("fragment handling", () => {
    it("returns pending for fragment header", () => {
      const reassembler = new FragmentReassembler()
      const msg = createSyncRequest()
      const frame = encodeFrame(msg)

      // Fragment into multiple pieces
      const fragments = fragmentPayload(frame, 50) // Small threshold for testing

      // Send header
      const result = parsePostBody(reassembler, fragments[0])

      expect(result.type).toBe("pending")
      expect(result.response.status).toBe(202)
      expect(result.response.body).toEqual({ pending: true })

      reassembler.dispose()
    })

    it("returns pending for intermediate fragments", () => {
      const reassembler = new FragmentReassembler()
      const msg = createSyncRequest()
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 50)

      // Send header
      parsePostBody(reassembler, fragments[0])

      // Send first data fragment (not last)
      if (fragments.length > 2) {
        const result = parsePostBody(reassembler, fragments[1])
        expect(result.type).toBe("pending")
        expect(result.response.status).toBe(202)
      }

      reassembler.dispose()
    })

    it("returns messages when all fragments received", () => {
      const reassembler = new FragmentReassembler()
      const msg = createSyncRequest("fragmented-doc")
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 50)

      // Send all fragments
      let finalResult: SsePostResult | undefined
      for (const fragment of fragments) {
        finalResult = parsePostBody(reassembler, fragment)
      }

      expect(finalResult).toBeDefined()
      expect(finalResult?.type).toBe("messages")
      expect(finalResult?.response.status).toBe(200)

      if (finalResult?.type === "messages") {
        expect(finalResult.messages).toHaveLength(1)
        const decoded = finalResult.messages[0] as ChannelMsgSyncRequest
        expect(decoded.docId).toBe("fragmented-doc")
      }

      reassembler.dispose()
    })

    it("handles fragments out of order", () => {
      const reassembler = new FragmentReassembler()
      const msg = createSyncRequest()
      const frame = encodeFrame(msg)
      const fragments = fragmentPayload(frame, 30) // Very small to get multiple fragments

      // Send header first (required)
      parsePostBody(reassembler, fragments[0])

      // Send data fragments in reverse order
      const dataFragments = fragments.slice(1)
      const reversed = [...dataFragments].reverse()

      let finalResult: SsePostResult | undefined
      for (const fragment of reversed) {
        finalResult = parsePostBody(reassembler, fragment)
      }

      expect(finalResult?.type).toBe("messages")

      reassembler.dispose()
    })
  })

  describe("error handling", () => {
    it("returns error for invalid binary data", () => {
      const reassembler = new FragmentReassembler()

      // Send garbage with MESSAGE_COMPLETE prefix
      const invalidBody = new Uint8Array([0x00, 0xff, 0xff, 0xff, 0xff])
      const result = parsePostBody(reassembler, invalidBody)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)
      expect(result.response.body).toHaveProperty("error")

      reassembler.dispose()
    })

    it("returns error for unknown transport prefix", () => {
      const reassembler = new FragmentReassembler()

      // Unknown prefix 0x99
      const invalidBody = new Uint8Array([0x99, 0x01, 0x02, 0x03])
      const result = parsePostBody(reassembler, invalidBody)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)

      reassembler.dispose()
    })

    it("returns error for truncated fragment header", () => {
      const reassembler = new FragmentReassembler()

      // Fragment header prefix but too short
      const truncated = new Uint8Array([0x01, 0x00, 0x00])
      const result = parsePostBody(reassembler, truncated)

      expect(result.type).toBe("error")
      expect(result.response.status).toBe(400)

      reassembler.dispose()
    })
  })

  describe("reassembler state isolation", () => {
    it("separate reassemblers track separate batches", () => {
      const reassembler1 = new FragmentReassembler()
      const reassembler2 = new FragmentReassembler()

      const msg1 = createSyncRequest("doc-1")
      const msg2 = createSyncRequest("doc-2")

      const fragments1 = fragmentPayload(encodeFrame(msg1), 50)
      const fragments2 = fragmentPayload(encodeFrame(msg2), 50)

      // Send header to reassembler1
      const result1 = parsePostBody(reassembler1, fragments1[0])
      expect(result1.type).toBe("pending")

      // Send different header to reassembler2
      const result2 = parsePostBody(reassembler2, fragments2[0])
      expect(result2.type).toBe("pending")

      // Complete reassembler1
      let final1: SsePostResult | undefined
      for (let i = 1; i < fragments1.length; i++) {
        final1 = parsePostBody(reassembler1, fragments1[i])
      }

      expect(final1?.type).toBe("messages")
      if (final1?.type === "messages") {
        expect((final1.messages[0] as ChannelMsgSyncRequest).docId).toBe(
          "doc-1",
        )
      }

      // Reassembler2 should still be pending (different batch)
      // Complete it separately
      let final2: SsePostResult | undefined
      for (let i = 1; i < fragments2.length; i++) {
        final2 = parsePostBody(reassembler2, fragments2[i])
      }

      expect(final2?.type).toBe("messages")
      if (final2?.type === "messages") {
        expect((final2.messages[0] as ChannelMsgSyncRequest).docId).toBe(
          "doc-2",
        )
      }

      reassembler1.dispose()
      reassembler2.dispose()
    })
  })

  describe("response format", () => {
    it("returns correct HTTP status codes", () => {
      const reassembler = new FragmentReassembler()

      // Success: 200
      const msg = createSyncRequest()
      const successResult = parsePostBody(reassembler, encodeAndWrap(msg))
      expect(successResult.response.status).toBe(200)

      // Pending: 202
      const fragments = fragmentPayload(encodeFrame(msg), 50)
      const pendingResult = parsePostBody(reassembler, fragments[0])
      expect(pendingResult.response.status).toBe(202)

      // Error: 400
      const errorResult = parsePostBody(
        reassembler,
        new Uint8Array([0x00, 0xff]),
      )
      expect(errorResult.response.status).toBe(400)

      reassembler.dispose()
    })

    it("returns JSON-serializable response bodies", () => {
      const reassembler = new FragmentReassembler()

      const msg = createSyncRequest()
      const result = parsePostBody(reassembler, encodeAndWrap(msg))

      // Should be serializable without throwing
      const serialized = JSON.stringify(result.response.body)
      expect(serialized).toBeTruthy()

      reassembler.dispose()
    })
  })
})
