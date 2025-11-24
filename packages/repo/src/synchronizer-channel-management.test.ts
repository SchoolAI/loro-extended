/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "./channel.js"
import { createPermissions } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"
import type { ChannelId } from "./types.js"

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
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
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
    })
  })

  it("should handle channel addition", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    const retrievedChannel = synchronizer.getChannel(channel.channelId)
    expect(retrievedChannel).toBeDefined()
    expect(retrievedChannel?.channelId).toBe(channel.channelId)
  })

  it("should handle channel removal", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    expect(synchronizer.getChannel(channel.channelId)).toBeDefined()

    mockAdapter.simulateChannelRemoved(channel.channelId)
    expect(synchronizer.getChannel(channel.channelId)).toBeUndefined()
    // Channel stop is called during removal
    expect(vi.mocked(channel.stop)).toHaveBeenCalled()
  })

  it("should return undefined for non-existent channel", () => {
    const channel = synchronizer.getChannel(999)
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
    // We need to get the channel first to pass it to onChannelReceive
    const connectedChannel = synchronizer.getChannel(channel.channelId)
    expect(connectedChannel).toBeDefined()

    if (connectedChannel) {
      synchronizer.channelReceive(connectedChannel, {
        type: "channel/establish-response",
        identity: {
          peerId: "test-peer-id" as any,
          name: "test-peer",
          type: "user",
        },
      })
    }

    // Get the established channel and simulate the peer subscribing
    const updatedChannel = synchronizer.getChannel(channel.channelId)
    expect(updatedChannel?.type).toBe("established")

    if (updatedChannel && updatedChannel.type === "established") {
      // Now simulate sync-requests which will add subscriptions
      synchronizer.channelReceive(updatedChannel, {
        type: "channel/sync-request",
        docs: [
          {
            docId: docId1,
            requesterDocVersion: synchronizer
              .getDocumentState(docId1)!
              .doc.version(),
          },
          {
            docId: docId2,
            requesterDocVersion: synchronizer
              .getDocumentState(docId2)!
              .doc.version(),
          },
        ],
      })
    }

    // Wait for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    const docIds = synchronizer.getChannelDocIds(channel.channelId)
    expect(docIds).toContain(docId1)
    expect(docIds).toContain(docId2)
    expect(docIds).toHaveLength(2)
  })
})
