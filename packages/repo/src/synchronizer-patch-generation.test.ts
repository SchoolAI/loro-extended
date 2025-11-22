/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import type { Patch } from "mutative"
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

describe("Synchronizer - Patch Generation", () => {
  let mockAdapter: MockAdapter
  let patches: Patch[]
  let onPatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    patches = []
    onPatch = vi.fn((newPatches: Patch[]) => {
      patches.push(...newPatches)
    })
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
  })

  it("should generate patches when onPatch is provided", async () => {
    new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      onUpdate: onPatch,
    })

    await mockAdapter.waitForStart()
    mockAdapter.simulateChannelAdded("test-channel")

    expect(onPatch).toHaveBeenCalled()
    expect(patches.length).toBeGreaterThan(0)

    // Should contain channel-related patches
    const channelPatch = patches.find(p => p.path[0] === "channels")
    expect(channelPatch).toBeDefined()
  })

  it("should work without onPatch callback", () => {
    const syncWithoutPatch = new Synchronizer({
      identity: { peerId: "1", name: "test", type: "user" },
      adapters: [new MockAdapter({ adapterId: "test" }) as AnyAdapter],
    })

    // Should not throw when no patch callback is provided
    expect(syncWithoutPatch).toBeDefined()
  })
})
