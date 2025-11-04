/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "./channel.js"
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
}

describe("Synchronizer - Adapter Integration", () => {
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
  })

  it("should send messages through adapters", async () => {
    new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [mockAdapter as AnyAdapter],
    })

    await mockAdapter.waitForStart()
    mockAdapter.simulateChannelAdded("test-channel")

    // Should have sent establish-request message
    expect(mockAdapter.sentMessages).toHaveLength(1)
    expect(mockAdapter.sentMessages[0].message.type).toBe(
      "channel/establish-request",
    )
  })

  it("should handle multiple adapters", async () => {
    const adapter1 = new MockAdapter({ adapterId: "adapter-1" })
    const adapter2 = new MockAdapter({ adapterId: "adapter-2" })

    const multiSync = new Synchronizer({
      identity: { name: "test" },
      adapters: [adapter1 as AnyAdapter, adapter2 as AnyAdapter],
    })

    await adapter1.waitForStart()
    await adapter2.waitForStart()
    const channel1 = adapter1.simulateChannelAdded("channel-1")
    const channel2 = adapter2.simulateChannelAdded("channel-2")

    expect(multiSync.getChannel(channel1.channelId)).toBeDefined()
    expect(multiSync.getChannel(channel2.channelId)).toBeDefined()
  })
})