import { describe, expect, it, vi } from "vitest"
import type {
  AddressedEstablishedEnvelope,
  BatchableMsg,
  ChannelMsgBatch,
} from "../channel.js"
import type { ChannelId } from "../types.js"
import { OutboundBatcher } from "./outbound-batcher.js"

// Helper to create test messages
function createSyncResponse(docId: string): BatchableMsg {
  return {
    type: "channel/sync-response",
    docId,
    transmission: { type: "up-to-date", version: { length: () => 0 } as never },
  }
}

function createEphemeralMsg(docId: string): BatchableMsg {
  return {
    type: "channel/ephemeral",
    docId,
    hopsRemaining: 1,
    stores: [],
  }
}

// Test channel IDs (ChannelId is a number)
const CHANNEL_1: ChannelId = 1
const CHANNEL_2: ChannelId = 2

describe("OutboundBatcher", () => {
  describe("queue", () => {
    it("should queue messages for a channel", () => {
      const batcher = new OutboundBatcher()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))

      expect(batcher.pendingChannelCount).toBe(1)
      expect(batcher.pendingMessageCount).toBe(1)
    })

    it("should queue multiple messages for the same channel", () => {
      const batcher = new OutboundBatcher()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_1, createSyncResponse("doc-2"))

      expect(batcher.pendingChannelCount).toBe(1)
      expect(batcher.pendingMessageCount).toBe(2)
    })

    it("should queue messages for different channels", () => {
      const batcher = new OutboundBatcher()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_2, createSyncResponse("doc-2"))

      expect(batcher.pendingChannelCount).toBe(2)
      expect(batcher.pendingMessageCount).toBe(2)
    })
  })

  describe("flush", () => {
    it("should send single message directly without batch wrapper", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.flush(send)

      expect(send).toHaveBeenCalledTimes(1)
      const envelope = send.mock.calls[0][0] as AddressedEstablishedEnvelope
      expect(envelope.toChannelIds).toEqual([CHANNEL_1])
      expect(envelope.message.type).toBe("channel/sync-response")
    })

    it("should wrap multiple messages in a batch", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_1, createSyncResponse("doc-2"))
      batcher.flush(send)

      expect(send).toHaveBeenCalledTimes(1)
      const envelope = send.mock.calls[0][0] as AddressedEstablishedEnvelope
      expect(envelope.toChannelIds).toEqual([CHANNEL_1])
      expect(envelope.message.type).toBe("channel/batch")
      const batch = envelope.message as ChannelMsgBatch
      expect(batch.messages).toHaveLength(2)
    })

    it("should send to multiple channels separately", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_2, createEphemeralMsg("doc-2"))
      batcher.flush(send)

      expect(send).toHaveBeenCalledTimes(2)

      const envelopes = send.mock.calls.map(
        call => call[0] as AddressedEstablishedEnvelope,
      )
      const channelIds = envelopes.map(e => e.toChannelIds[0])
      expect(channelIds).toContain(CHANNEL_1)
      expect(channelIds).toContain(CHANNEL_2)
    })

    it("should clear buffer after flush", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.flush(send)

      expect(batcher.pendingChannelCount).toBe(0)
      expect(batcher.pendingMessageCount).toBe(0)
      expect(batcher.hasPending).toBe(false)
    })

    it("should not call send for empty buffer", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.flush(send)

      expect(send).not.toHaveBeenCalled()
    })

    it("should handle reentrancy - new messages queued during flush go to fresh buffer", () => {
      const batcher = new OutboundBatcher()
      const sentEnvelopes: AddressedEstablishedEnvelope[] = []

      const send = (envelope: AddressedEstablishedEnvelope) => {
        sentEnvelopes.push(envelope)
        // Simulate synchronous adapter reply that queues more messages
        if (sentEnvelopes.length === 1) {
          batcher.queue(CHANNEL_2, createSyncResponse("doc-2"))
        }
      }

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.flush(send)

      // First flush only sent the original message
      expect(sentEnvelopes).toHaveLength(1)
      expect(sentEnvelopes[0].toChannelIds).toEqual([CHANNEL_1])

      // New message is in the fresh buffer
      expect(batcher.pendingChannelCount).toBe(1)
      expect(batcher.pendingMessageCount).toBe(1)

      // Second flush sends the new message
      batcher.flush(send)
      expect(sentEnvelopes).toHaveLength(2)
      expect(sentEnvelopes[1].toChannelIds).toEqual([CHANNEL_2])
    })
  })

  describe("hasPending", () => {
    it("should return false when empty", () => {
      const batcher = new OutboundBatcher()
      expect(batcher.hasPending).toBe(false)
    })

    it("should return true when messages are queued", () => {
      const batcher = new OutboundBatcher()
      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      expect(batcher.hasPending).toBe(true)
    })

    it("should return false after flush", () => {
      const batcher = new OutboundBatcher()
      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.flush(() => {})
      expect(batcher.hasPending).toBe(false)
    })
  })

  describe("message ordering", () => {
    it("should preserve message order within a channel", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_1, createSyncResponse("doc-2"))
      batcher.queue(CHANNEL_1, createSyncResponse("doc-3"))
      batcher.flush(send)

      const envelope = send.mock.calls[0][0] as AddressedEstablishedEnvelope
      const batch = envelope.message as ChannelMsgBatch
      expect(batch.messages[0]).toMatchObject({ docId: "doc-1" })
      expect(batch.messages[1]).toMatchObject({ docId: "doc-2" })
      expect(batch.messages[2]).toMatchObject({ docId: "doc-3" })
    })
  })

  describe("mixed message types", () => {
    it("should batch different message types together", () => {
      const batcher = new OutboundBatcher()
      const send = vi.fn()

      batcher.queue(CHANNEL_1, createSyncResponse("doc-1"))
      batcher.queue(CHANNEL_1, createEphemeralMsg("doc-1"))
      batcher.flush(send)

      const envelope = send.mock.calls[0][0] as AddressedEstablishedEnvelope
      const batch = envelope.message as ChannelMsgBatch
      expect(batch.messages[0].type).toBe("channel/sync-response")
      expect(batch.messages[1].type).toBe("channel/ephemeral")
    })
  })
})
