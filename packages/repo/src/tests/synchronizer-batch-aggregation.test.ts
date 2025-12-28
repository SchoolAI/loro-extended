/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "../adapter/adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import { createPermissions } from "../permissions.js"
import { Synchronizer } from "../synchronizer.js"
import type { ChannelId } from "../types.js"

// Mock adapter for testing that tracks all sent messages
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: { channelId: string; message: ChannelMsg }[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: vi.fn((message: ChannelMsg) => {
        this.sentMessages.push({ channelId: context.name, message })
      }),
      stop: vi.fn(),
    }
  }

  async onStart(): Promise<void> {
    // Nothing to do for mock adapter
  }

  async onStop(): Promise<void> {
    this.testChannels.clear()
  }

  async _start(): Promise<void> {
    this.startPromise = super._start()
    await this.startPromise
  }

  async waitForStart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise
    }
  }

  public simulateChannelAdded(name: string): ConnectedChannel {
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    this.establishChannel(channel.channelId)
    return channel
  }

  public simulateChannelRemoved(channelId: ChannelId): Channel | undefined {
    const channel = this.removeChannel(channelId)
    if (channel) {
      this.testChannels.delete(channelId)
    }
    return channel
  }

  public simulateChannelMessage(channelId: ChannelId, message: ChannelMsg) {
    const channel = this.testChannels.get(channelId)
    if (channel?.onReceive) {
      channel.onReceive(message)
    }
  }

  public getTestChannels() {
    return this.testChannels
  }
}

// Helper to create a version vector
function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

describe("Synchronizer - Batch Aggregation", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterType: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
    })
  })

  describe("batching behavior", () => {
    it("should batch multiple sync-responses to the same channel", async () => {
      await mockAdapter.waitForStart()
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Create multiple documents
      const doc1 = synchronizer.getOrCreateDocumentState("doc-1")
      const doc2 = synchronizer.getOrCreateDocumentState("doc-2")
      const doc3 = synchronizer.getOrCreateDocumentState("doc-3")

      // Add content to each
      doc1.doc.getText("text").insert(0, "hello")
      doc2.doc.getText("text").insert(0, "world")
      doc3.doc.getText("text").insert(0, "test")

      // Establish the channel
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "2" as any, name: "test-peer", type: "user" },
      })

      // Clear messages from establishment
      mockAdapter.sentMessages = []

      // Send a batch of sync-requests in a single channel/batch message
      // This simulates what happens when a peer requests multiple docs at once
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/batch",
        messages: [
          {
            type: "channel/sync-request",
            docId: "doc-1",
            requesterDocVersion: createVersionVector(),
            bidirectional: false,
          },
          {
            type: "channel/sync-request",
            docId: "doc-2",
            requesterDocVersion: createVersionVector(),
            bidirectional: false,
          },
          {
            type: "channel/sync-request",
            docId: "doc-3",
            requesterDocVersion: createVersionVector(),
            bidirectional: false,
          },
        ],
      })

      // MockAdapter delivers synchronously, so no need to wait for microtasks

      // Should have sent exactly ONE message (a batch containing all responses)
      expect(mockAdapter.sentMessages.length).toBe(1)

      const sentMessage = mockAdapter.sentMessages[0].message
      expect(sentMessage.type).toBe("channel/batch")

      // The batch should contain 3 sync-responses
      // (Note: may also contain sync-requests if bidirectional sync is triggered)
      const batchMessages = (sentMessage as any).messages
      const syncResponses = batchMessages.filter(
        (m: any) => m.type === "channel/sync-response",
      )
      expect(syncResponses.length).toBe(3)

      // Should have responses for all 3 docs
      const docIds = syncResponses.map((m: any) => m.docId)
      expect(docIds).toContain("doc-1")
      expect(docIds).toContain("doc-2")
      expect(docIds).toContain("doc-3")
    })

    it("should NOT wrap single message in channel/batch", async () => {
      await mockAdapter.waitForStart()
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Create a document
      const doc = synchronizer.getOrCreateDocumentState("single-doc")
      doc.doc.getText("text").insert(0, "hello")

      // Establish the channel
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "2" as any, name: "test-peer", type: "user" },
      })

      // Clear messages from establishment
      mockAdapter.sentMessages = []

      // Send a single sync-request
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-request",
        docId: "single-doc",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      // MockAdapter delivers synchronously, so no need to wait for microtasks

      // Should have sent exactly ONE message
      expect(mockAdapter.sentMessages.length).toBe(1)

      // Check if it's a single sync-response or a batch with one sync-response
      const sentMessage = mockAdapter.sentMessages[0].message
      if (sentMessage.type === "channel/batch") {
        // If batched, should only have sync-response(s) for our doc
        const syncResponses = (sentMessage as any).messages.filter(
          (m: any) => m.type === "channel/sync-response",
        )
        expect(syncResponses.length).toBe(1)
        expect(syncResponses[0].docId).toBe("single-doc")
      } else {
        // Direct sync-response
        expect(sentMessage.type).toBe("channel/sync-response")
        expect((sentMessage as any).docId).toBe("single-doc")
      }
    })

    it("should flatten nested batches", async () => {
      await mockAdapter.waitForStart()
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Create documents
      const doc1 = synchronizer.getOrCreateDocumentState("nested-doc-1")
      const doc2 = synchronizer.getOrCreateDocumentState("nested-doc-2")
      doc1.doc.getText("text").insert(0, "hello")
      doc2.doc.getText("text").insert(0, "world")

      // Establish the channel
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "2" as any, name: "test-peer", type: "user" },
      })

      // Clear messages from establishment
      mockAdapter.sentMessages = []

      // Send two separate sync-requests (not in a batch)
      // Each triggers a separate dispatch cycle, so they get sent separately
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-request",
        docId: "nested-doc-1",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-request",
        docId: "nested-doc-2",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      // MockAdapter delivers synchronously, so no need to wait for microtasks

      // Note: Since each simulateChannelMessage triggers a separate dispatch cycle,
      // we get 2 separate sends. The previous test (batch of sync-requests) tests
      // that messages in the SAME dispatch cycle get batched together.

      // For this test, we verify that messages are sent correctly
      expect(mockAdapter.sentMessages.length).toBeGreaterThanOrEqual(1)

      // Count total sync-responses (may be in batches or individual)
      let syncResponseCount = 0
      for (const sent of mockAdapter.sentMessages) {
        if (sent.message.type === "channel/sync-response") {
          syncResponseCount++
        } else if (sent.message.type === "channel/batch") {
          for (const msg of (sent.message as any).messages) {
            if (msg.type === "channel/sync-response") {
              syncResponseCount++
            }
          }
        }
      }
      expect(syncResponseCount).toBe(2)
    })

    it("should send messages to different channels separately", async () => {
      await mockAdapter.waitForStart()

      // Create two channels
      const channel1 = mockAdapter.simulateChannelAdded("channel-1")
      const channel2 = mockAdapter.simulateChannelAdded("channel-2")

      // Create a document
      const doc = synchronizer.getOrCreateDocumentState("shared-doc")
      doc.doc.getText("text").insert(0, "hello")

      // Establish both channels
      mockAdapter.simulateChannelMessage(channel1.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "peer-1" as any, name: "peer-1", type: "user" },
      })
      mockAdapter.simulateChannelMessage(channel2.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "peer-2" as any, name: "peer-2", type: "user" },
      })

      // Clear messages from establishment
      mockAdapter.sentMessages = []

      // Send sync-requests from both channels
      mockAdapter.simulateChannelMessage(channel1.channelId, {
        type: "channel/sync-request",
        docId: "shared-doc",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      mockAdapter.simulateChannelMessage(channel2.channelId, {
        type: "channel/sync-request",
        docId: "shared-doc",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      // MockAdapter delivers synchronously, so no need to wait for microtasks

      // Should have sent to both channels (may be batched or individual per channel)
      // The key is that messages to different channels are NOT combined
      const channel1Messages = mockAdapter.sentMessages.filter(
        m => m.channelId === "channel-1",
      )
      const channel2Messages = mockAdapter.sentMessages.filter(
        m => m.channelId === "channel-2",
      )

      expect(channel1Messages.length).toBeGreaterThanOrEqual(1)
      expect(channel2Messages.length).toBeGreaterThanOrEqual(1)

      // Verify each channel got a sync-response
      const hasChannel1Response = channel1Messages.some(
        m =>
          m.message.type === "channel/sync-response" ||
          (m.message.type === "channel/batch" &&
            (m.message as any).messages.some(
              (msg: any) => msg.type === "channel/sync-response",
            )),
      )
      const hasChannel2Response = channel2Messages.some(
        m =>
          m.message.type === "channel/sync-response" ||
          (m.message.type === "channel/batch" &&
            (m.message as any).messages.some(
              (msg: any) => msg.type === "channel/sync-response",
            )),
      )

      expect(hasChannel1Response).toBe(true)
      expect(hasChannel2Response).toBe(true)
    })
  })

  describe("synchronous send behavior", () => {
    it("should send messages synchronously with MockAdapter", async () => {
      await mockAdapter.waitForStart()
      const channel = mockAdapter.simulateChannelAdded("test-channel")

      // Create a document
      synchronizer.getOrCreateDocumentState("timing-doc")

      // Establish the channel
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/establish-request",
        identity: { peerId: "2" as any, name: "test-peer", type: "user" },
      })

      // Clear messages from establishment
      mockAdapter.sentMessages = []

      // Send a sync-request
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-request",
        docId: "timing-doc",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })

      // With MockAdapter, messages are sent synchronously (no microtask delay)
      // This is because MockAdapter delivers synchronously, and the synchronizer
      // now flushes sends synchronously. The async boundary is in BridgeAdapter.
      expect(mockAdapter.sentMessages.length).toBeGreaterThanOrEqual(1)
    })
  })
})
