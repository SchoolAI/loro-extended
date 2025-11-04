/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "./channel.js"
import { isEstablished } from "./channel.js"
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

  // Override _start to track when it completes
  async _start(): Promise<void> {
    this.startPromise = super._start()
    await this.startPromise
  }

  // Wait for adapter to be started
  async waitForStart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise
    }
  }

  // Test helpers
  public simulateChannelAdded(name: string): ConnectedChannel {
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    // Establish the channel to trigger the establishment handshake
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

describe("Synchronizer - Command Execution", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
    })
  })

  it("should execute send-sync-response command", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer" },
    })

    // Add some content to the document
    docState.doc.getText("test").insert(0, "hello")

    // Clear previous messages to make counting easier
    mockAdapter.sentMessages = []

    // Simulate sync request that should trigger sync response
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: createVersionVector(),
        },
      ],
    })

    // Should have sent sync-response
    expect(mockAdapter.sentMessages.length).toBeGreaterThanOrEqual(1)
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.docId).toBe(docId)
  })

  it("should handle establish channel doc command", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Simulate establish request/response to get channel into established state
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "requester-peer" },
    })

    // Channel should be in established state
    const updatedChannel = synchronizer.getChannel(channel.channelId)
    expect(updatedChannel && isEstablished(updatedChannel)).toBe(true)
  })

  it("should handle batch commands", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Simulate establish request which should generate batch command
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "requester-peer" },
    })

    // Should have executed multiple commands (establish + send message)
    expect(mockAdapter.sentMessages.length).toBeGreaterThan(1)
  })
})