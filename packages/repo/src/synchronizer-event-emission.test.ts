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

// Helper to create a version vector
function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

describe("Synchronizer - Event Emission", () => {
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

  it("should emit ready-state-changed events", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer" },
    })

    // Set up event listener
    const readyStatePromise = new Promise(resolve => {
      synchronizer.emitter.on("ready-state-changed", resolve)
    })

    // Simulate sync response that changes loading state
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "up-to-date",
        version: createVersionVector(),
      },
    })

    const event = await readyStatePromise
    expect(event).toMatchObject({
      docId,
      readyStates: expect.any(Array),
    })
  })

  it("should support waitUntilReady with predicate", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer" },
    })

    // Start waiting for ready state
    const waitPromise = synchronizer.waitUntilReady(docId, readyStates =>
      readyStates.some(state => state.loading.state === "found"),
    )

    // Simulate sync response that satisfies the predicate
    setImmediate(() => {
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-response",
        docId,
        transmission: {
          type: "up-to-date",
          version: createVersionVector(),
        },
      })
    })

    // Should resolve when predicate is satisfied
    await expect(waitPromise).resolves.toBeUndefined()
  })
})
