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
import { createRules } from "../rules.js"
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

describe("Synchronizer - Snapshot vs Update Behavior", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      rules: createRules(),
    })
  })

  it("should send snapshot when requester has empty version vector", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Add some content to the document
    docState.doc.getText("text").insert(0, "hello world")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "test-peer", type: "user" },
    })

    // Clear previous messages AFTER establishment
    mockAdapter.sentMessages = []

    // Create empty version vector and verify it's empty
    const emptyVersion = createVersionVector()
    expect(emptyVersion.length()).toBe(0)

    // Simulate sync request with empty version (new client)
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: emptyVersion,
        },
      ],
    })

    // Should have sent sync-response with snapshot
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )

    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("snapshot")
    expect(syncResponse.message.transmission.data).toBeDefined()
    expect(syncResponse.message.transmission.version).toBeDefined()
  })

  it("should send update when requester has non-empty version vector", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Add some content to the document
    docState.doc.getText("text").insert(0, "hello world")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "test-peer", type: "user" },
    })

    // Clear previous messages
    mockAdapter.sentMessages = []

    // Create a version vector with some state (non-empty)
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("text").insert(0, "initial")
    const nonEmptyVersion = sourceDoc.version()

    // Simulate sync request with non-empty version
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: nonEmptyVersion,
        },
      ],
    })

    // Should have sent sync-response with update
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("update")
    expect(syncResponse.message.transmission.data).toBeDefined()
    // Update SHOULD include version field now
    expect(syncResponse.message.transmission.version).toBeDefined()
  })

  it("should include version in snapshot transmission", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Add some content to the document
    docState.doc.getText("text").insert(0, "hello world")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "test-peer", type: "user" },
    })

    // Clear previous messages
    mockAdapter.sentMessages = []

    // Simulate sync request with empty version (new client)
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: createVersionVector(),
        },
      ],
    })

    // Get the sync response
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    const transmission = syncResponse.message.transmission

    // Verify snapshot includes version
    expect(transmission.type).toBe("snapshot")
    expect(transmission.version).toBeDefined()
    expect(transmission.version.length()).toBeGreaterThanOrEqual(0)
  })

  it("should include version in update transmission", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Add some content to the document
    docState.doc.getText("text").insert(0, "hello world")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "test-peer", type: "user" },
    })

    // Clear previous messages
    mockAdapter.sentMessages = []

    // Create a version vector with some state (non-empty)
    const sourceDoc = new LoroDoc()
    sourceDoc.getText("text").insert(0, "initial")
    const nonEmptyVersion = sourceDoc.version()

    // Simulate sync request with non-empty version
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: nonEmptyVersion,
        },
      ],
    })

    // Get the sync response
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    const transmission = syncResponse.message.transmission

    // Verify update DOES include version
    expect(transmission.type).toBe("update")
    expect(transmission.version).toBeDefined()
  })

  it("should handle client refresh scenario (empty doc, empty version)", async () => {
    await mockAdapter.waitForStart()
    const docId = "todo-list"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Simulate server having data
    docState.doc.getList("todos").push("Buy milk")
    docState.doc.getList("todos").push("Walk dog")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "client", type: "user" },
    })

    // Clear previous messages
    mockAdapter.sentMessages = []

    // Simulate client refresh: empty version vector
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: createVersionVector(),
        },
      ],
    })

    // Should send snapshot with all data
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("snapshot")
    expect(syncResponse.message.transmission.data).toBeDefined()
    expect(syncResponse.message.transmission.data.length).toBeGreaterThan(0)
  })

  it("should handle incremental sync scenario (non-empty version)", async () => {
    await mockAdapter.waitForStart()
    const docId = "todo-list"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Simulate server having data
    docState.doc.getList("todos").push("Buy milk")
    docState.doc.getList("todos").push("Walk dog")
    docState.doc.getList("todos").push("Cook dinner")

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1" as any, name: "client", type: "user" },
    })

    // Clear previous messages
    mockAdapter.sentMessages = []

    // Simulate client that already has some state
    const clientVersion = (() => {
      const doc = new LoroDoc()
      doc.getList("todos").push("Buy milk")
      return doc.version()
    })()

    // Simulate sync request with client's version
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-request",
      docs: [
        {
          docId,
          requesterDocVersion: clientVersion,
        },
      ],
    })

    // Should send update (not snapshot)
    const syncResponse = mockAdapter.sentMessages.find(
      msg => msg.message.type === "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
    expect(syncResponse.message.transmission.type).toBe("update")
    expect(syncResponse.message.transmission.version).toBeDefined()
  })
})
