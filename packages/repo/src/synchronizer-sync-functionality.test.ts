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

describe("Synchronizer - Sync Functionality", () => {
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

  it("should handle sync response with document data", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Create valid document data
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("test").insert(0, "hello world")
    const data = sourceDoc.export({ mode: "snapshot" })

    // Simulate receiving sync response
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "snapshot",
        data,
        version: sourceDoc.version(),
      },
    })

    // Document should have imported the data
    const updatedDocState = synchronizer.getDocumentState(docId)
    expect(updatedDocState?.doc.toJSON()).toEqual({ test: "hello world" })
  })

  it("should respond with up-to-date when versions match", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Create some content
    docState.doc.getText("test").insert(0, "hello world")
    docState.doc.commit()
    const currentVersion = docState.doc.version()

    // Clear sent messages
    mockAdapter.sentMessages = []

    // Simulate receiving sync request with current version
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: currentVersion,
        },
      ],
      bidirectional: false,
    })

    // Check response
    const syncResponse = mockAdapter.sentMessages.find(
      m => m.message.type === "channel/sync-response",
    )

    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("up-to-date")
  })

  it("should respond with up-to-date when requester is ahead", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Create a version that is ahead
    const otherDoc = new LoroDoc()
    otherDoc.getText("test").insert(0, "ahead")
    otherDoc.commit()
    const aheadVersion = otherDoc.version()

    // Clear sent messages
    mockAdapter.sentMessages = []

    // Simulate receiving sync request with ahead version
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: aheadVersion,
        },
      ],
      bidirectional: false,
    })

    // Check response
    const syncResponse = mockAdapter.sentMessages.find(
      m => m.message.type === "channel/sync-response",
    )

    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("up-to-date")
  })
})
