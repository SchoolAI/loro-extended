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
import { isEstablished } from "../channel.js"
import { createPermissions } from "../permissions.js"
import { findMessage } from "../synchronizer/test-utils.js"
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
    mockAdapter = new MockAdapter({ adapterType: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
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
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Add some content to the document
    docState.doc.getText("test").insert(0, "hello")

    // Clear previous messages to make counting easier
    mockAdapter.sentMessages = []

    // Simulate sync request that should trigger sync response
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docId,
      requesterDocVersion: createVersionVector(),
      bidirectional: false,
    })

    // MockAdapter delivers synchronously, so no need to wait for microtasks
    // (BridgeAdapter uses queueMicrotask for async delivery, but MockAdapter doesn't)

    // Should have sent sync-response (may be inside a batch)
    expect(mockAdapter.sentMessages.length).toBeGreaterThanOrEqual(1)
    const syncResponse = findMessage(
      mockAdapter.sentMessages,
      "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
    expect(syncResponse?.message.docId).toBe(docId)
  })

  it("should handle establish channel doc command", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Simulate establish request/response to get channel into established state
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "requester-peer", type: "user" },
    })

    // Channel should be in established state
    const updatedChannel = synchronizer.model.channels.get(channel.channelId)
    expect(updatedChannel && isEstablished(updatedChannel)).toBe(true)
  })

  it("should handle batch commands", async () => {
    await mockAdapter.waitForStart()
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Simulate establish request which should generate batch command
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "requester-peer", type: "user" },
    })

    // Should have executed multiple commands (establish + send message)
    expect(mockAdapter.sentMessages.length).toBeGreaterThan(1)
  })
})
