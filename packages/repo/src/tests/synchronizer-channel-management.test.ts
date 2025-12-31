/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

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

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
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
}

describe("Synchronizer - Channel Management", () => {
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

  it("should handle channel addition", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    const retrievedChannel = synchronizer.model.channels.get(channel.channelId)
    expect(retrievedChannel).toBeDefined()
    expect(retrievedChannel?.channelId).toBe(channel.channelId)
  })

  it("should handle channel removal", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    expect(synchronizer.model.channels.get(channel.channelId)).toBeDefined()

    mockAdapter.simulateChannelRemoved(channel.channelId)
    expect(synchronizer.model.channels.get(channel.channelId)).toBeUndefined()
    // Channel stop is called during removal
    expect(vi.mocked(channel.stop)).toHaveBeenCalled()
  })

  it("should return undefined for non-existent channel", () => {
    const channel = synchronizer.model.channels.get(999 as ChannelId)
    expect(channel).toBeUndefined()
  })

  it("should get document IDs for channel", async () => {
    await mockAdapter.waitForStart()
    const docId1 = "doc-1"
    const docId2 = "doc-2"
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Create documents
    synchronizer.getOrCreateDocumentState(docId1)
    synchronizer.getOrCreateDocumentState(docId2)

    // Simulate receiving establish-response to create peer state
    synchronizer.channelReceive(channel.channelId, {
      type: "channel/establish-response",
      identity: {
        peerId: "12345",
        name: "test-peer",
        type: "user",
      },
    })

    // Get the established channel and simulate the peer subscribing
    const updatedChannel = synchronizer.model.channels.get(channel.channelId)
    expect(updatedChannel?.type).toBe("established")

    // Now simulate sync-requests which will add subscriptions (now sent as batch)
    synchronizer.channelReceive(channel.channelId, {
      type: "channel/batch",
      messages: [
        {
          type: "channel/sync-request",
          docId: docId1,
          requesterDocVersion: synchronizer
            .getOrCreateDocumentState(docId1)
            .doc.version(),
          bidirectional: false,
        },
        {
          type: "channel/sync-request",
          docId: docId2,
          requesterDocVersion: synchronizer
            .getOrCreateDocumentState(docId2)
            .doc.version(),
          bidirectional: false,
        },
      ],
    })

    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    const docIds = synchronizer.getChannelDocIds(channel.channelId)
    expect(docIds).toContain(docId1)
    expect(docIds).toContain(docId2)
    expect(docIds).toHaveLength(2)
  })
})
