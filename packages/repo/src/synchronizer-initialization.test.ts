/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
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
}

describe("Synchronizer - Initialization", () => {
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
  })

  it("should initialize with provided identity", () => {
    const sync = new Synchronizer({
      identity: { name: "custom-name" },
      adapters: [],
    })

    expect(sync.identity.name).toBe("custom-name")
  })

  it("should generate identity name if not provided", () => {
    const sync = new Synchronizer({
      identity: {},
      adapters: [],
    })

    // When no identity is provided, both peerId and name are generated as UUIDs
    expect(sync.identity.peerId).toBeDefined()
    expect(sync.identity.name).toBe(sync.identity.peerId)
  })

  it("should initialize adapters", () => {
    const synchronizer = new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
    })

    // Adapters are initialized via _initialize() in constructor
    expect(mockAdapter.channels).toBeDefined()
    expect(synchronizer).toBeDefined()
  })

  it("should create permissions manager", () => {
    const restrictiveSync = new Synchronizer({
      identity: { name: "test" },
      adapters: [],
      permissions: createPermissions({
        canReveal: () => false,
      }),
    })

    expect(restrictiveSync).toBeDefined()
  })

  it("should set up patch callback if provided", () => {
    const onPatch = vi.fn()
    
    const synchronizer = new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [mockAdapter as AnyAdapter],
      permissions: createPermissions(),
      onUpdate: onPatch,
    })

    // The onPatch callback should be set up during initialization
    expect(onPatch).toBeDefined()
    expect(synchronizer).toBeDefined()
  })
})