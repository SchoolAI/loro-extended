import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import type { AdapterId, PeerID, PeerIdentityDetails } from "../types.js"
import { Adapter, type AdapterHooks } from "./adapter.js"

// Mock adapter for testing
class MockAdapter extends Adapter<string> {
  onStartCalls = 0
  onStopCalls = 0
  generateCalls: string[] = []

  // Track what was passed to generate
  lastGeneratedContext: string | undefined

  constructor(adapterId: AdapterId = "mock-adapter") {
    super({ adapterId })
  }

  protected generate(context: string): GeneratedChannel {
    this.generateCalls.push(context)
    this.lastGeneratedContext = context

    return {
      adapterId: this.adapterId,
      kind: "network",
      send: vi.fn(),
      stop: vi.fn(),
    }
  }

  async onStart(): Promise<void> {
    this.onStartCalls++
  }

  async onStop(): Promise<void> {
    this.onStopCalls++
  }

  // Public test helpers to access protected methods
  testAddChannel(context: string): ConnectedChannel {
    return this.addChannel(context)
  }

  testRemoveChannel(channelId: number): Channel | undefined {
    return this.removeChannel(channelId)
  }
}

describe("Adapter", () => {
  let adapter: MockAdapter
  let hooks: {
    identity: PeerIdentityDetails
    onChannelAdded: ReturnType<typeof vi.fn>
    onChannelRemoved: ReturnType<typeof vi.fn>
    onChannelReceive: ReturnType<typeof vi.fn>
    onChannelEstablish: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    adapter = new MockAdapter()
    hooks = {
      identity: { peerId: "0", name: "test-peer" },
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    }
  })

  describe("Lifecycle State Management", () => {
    it("starts in 'created' state", () => {
      expect(adapter).toBeDefined()
      expect(adapter.adapterId).toBe("mock-adapter")
    })

    it("transitions from 'created' to 'initialized' on _initialize", () => {
      adapter._initialize(hooks)
      // State is internal, but we can verify behavior
      expect(() => adapter._initialize(hooks)).toThrow(
        "Adapter mock-adapter already initialized",
      )
    })

    it("transitions from 'initialized' to 'started' on _start", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      expect(adapter.onStartCalls).toBe(1)
    })

    it("transitions from 'started' to 'stopped' on _stop", async () => {
      adapter._initialize(hooks)
      await adapter._start()
      await adapter._stop()

      expect(adapter.onStopCalls).toBe(1)
      expect(adapter.channels.size).toBe(0)
    })

    it("allows re-initialization after stop (for test reuse)", async () => {
      adapter._initialize(hooks)
      await adapter._start()
      await adapter._stop()

      // Should allow re-initialization
      expect(() => adapter._initialize(hooks)).not.toThrow()
    })

    it("throws when starting without initialization", async () => {
      await expect(adapter._start()).rejects.toThrow(
        "Cannot start adapter mock-adapter",
      )
    })

    it("throws when initializing twice (without stop)", () => {
      adapter._initialize(hooks)

      expect(() => adapter._initialize(hooks)).toThrow(
        "Adapter mock-adapter already initialized",
      )
    })

    it("warns when stopping from non-started state", async () => {
      const warnSpy = vi.spyOn(adapter.logger, "warn")

      await adapter._stop()

      expect(warnSpy).toHaveBeenCalledWith(
        "Stopping adapter in unexpected state",
        expect.objectContaining({
          adapterId: "mock-adapter",
        }),
      )
    })
  })

  describe("Protected Method Access Control", () => {
    describe("addChannel", () => {
      it("throws when called before initialization", () => {
        expect(() => adapter.testAddChannel("test-context")).toThrow(
          "can't add channel in 'created' state (must be 'started')",
        )
      })

      it("throws when called in 'initialized' state", () => {
        adapter._initialize(hooks)

        expect(() => adapter.testAddChannel("test-context")).toThrow(
          "can't add channel in 'initialized' state (must be 'started')",
        )
      })

      it("succeeds when called in 'started' state", async () => {
        adapter._initialize(hooks)
        await adapter._start()

        const channel = adapter.testAddChannel("test-context")

        expect(channel).toBeDefined()
        expect(channel.channelId).toBeDefined()
        expect(adapter.channels.size).toBe(1)
      })

      it("throws when called after stop", async () => {
        adapter._initialize(hooks)
        await adapter._start()
        await adapter._stop()

        expect(() => adapter.testAddChannel("test-context")).toThrow(
          "can't add channel in 'stopped' state (must be 'started')",
        )
      })
    })

    describe("removeChannel", () => {
      it("throws when called before initialization", () => {
        expect(() => adapter.testRemoveChannel(1)).toThrow(
          "can't remove channel in 'created' state (must be 'started')",
        )
      })

      it("throws when called in 'initialized' state", () => {
        adapter._initialize(hooks)

        expect(() => adapter.testRemoveChannel(1)).toThrow(
          "can't remove channel in 'initialized' state (must be 'started')",
        )
      })

      it("succeeds when called in 'started' state", async () => {
        adapter._initialize(hooks)
        await adapter._start()

        const channel = adapter.testAddChannel("test-context")
        const removed = adapter.testRemoveChannel(channel.channelId)

        expect(removed).toBe(channel)
        expect(adapter.channels.size).toBe(0)
      })

      it("throws when called after stop", async () => {
        adapter._initialize(hooks)
        await adapter._start()
        await adapter._stop()

        expect(() => adapter.testRemoveChannel(1)).toThrow(
          "can't remove channel in 'stopped' state (must be 'started')",
        )
      })

      it("returns undefined when channel not found", async () => {
        adapter._initialize(hooks)
        await adapter._start()

        const removed = adapter.testRemoveChannel(999)

        expect(removed).toBeUndefined()
      })
    })
  })

  describe("Hook Integration", () => {
    it("calls onChannelAdded hook when channel is added", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")

      expect(hooks.onChannelAdded).toHaveBeenCalledTimes(1)
      expect(hooks.onChannelAdded).toHaveBeenCalledWith(channel)
    })

    it("calls onChannelRemoved hook when channel is removed", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")
      adapter.testRemoveChannel(channel.channelId)

      expect(hooks.onChannelRemoved).toHaveBeenCalledTimes(1)
      expect(hooks.onChannelRemoved).toHaveBeenCalledWith(channel)
    })

    it("does not call onChannelRemoved when channel not found", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      adapter.testRemoveChannel(999)

      expect(hooks.onChannelRemoved).not.toHaveBeenCalled()
    })

    it("calls onChannelReceive hook when channel receives message", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")
      const message: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "1", name: "test-peer" },
      }

      channel.onReceive(message)

      expect(hooks.onChannelReceive).toHaveBeenCalledTimes(1)
      expect(hooks.onChannelReceive).toHaveBeenCalledWith(channel, message)
    })

    it("hooks are available in 'started' state", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      // Add multiple channels and verify hooks work for all
      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      expect(hooks.onChannelAdded).toHaveBeenCalledTimes(2)

      adapter.testRemoveChannel(channel1.channelId)
      adapter.testRemoveChannel(channel2.channelId)

      expect(hooks.onChannelRemoved).toHaveBeenCalledTimes(2)
    })

    it("uses hooks from lifecycle state at time of channel creation", async () => {
      // This tests that hooks are captured in closures correctly
      adapter._initialize(hooks)
      await adapter._start()

      adapter.testAddChannel("test-context")

      // Create new hooks
      const newHooks: AdapterHooks = {
        identity: { peerId: "0" satisfies PeerID, name: "test-peer" },
        onChannelAdded: vi.fn(),
        onChannelRemoved: vi.fn(),
        onChannelReceive: vi.fn(),
        onChannelEstablish: vi.fn(),
      }

      // Stop and re-initialize with new hooks
      await adapter._stop()
      adapter._initialize(newHooks)
      await adapter._start()

      // The old channel's onReceive should still use the OLD hooks
      // (this verifies closure behavior)
      const message: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "2", name: "test-peer" },
      }

      // Note: After stop, the old channel is cleared, so we create a new one
      const newChannel = adapter.testAddChannel("new-context")
      newChannel.onReceive(message)

      // New hooks should be called for new channel
      expect(newHooks.onChannelReceive).toHaveBeenCalledWith(
        newChannel,
        message,
      )
      expect(hooks.onChannelReceive).not.toHaveBeenCalled()
    })

    it("channel.onReceive is properly wired to lifecycle hook", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")

      // Verify the channel has an onReceive handler
      expect(channel.onReceive).toBeDefined()
      expect(typeof channel.onReceive).toBe("function")

      // Call it and verify it triggers the lifecycle hook
      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      channel.onReceive(message)

      // Should call the lifecycle's onChannelReceive with the channel and message
      expect(hooks.onChannelReceive).toHaveBeenCalledTimes(1)
      expect(hooks.onChannelReceive).toHaveBeenCalledWith(channel, message)
    })

    it("multiple channels each have their own onReceive wired correctly", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const message1: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "1", name: "peer-1" },
      }

      const message2: ChannelMsg = {
        type: "channel/establish-response",
        identity: { peerId: "2", name: "peer-2" },
      }

      channel1.onReceive(message1)
      channel2.onReceive(message2)

      expect(hooks.onChannelReceive).toHaveBeenCalledTimes(2)
      expect(hooks.onChannelReceive).toHaveBeenNthCalledWith(
        1,
        channel1,
        message1,
      )
      expect(hooks.onChannelReceive).toHaveBeenNthCalledWith(
        2,
        channel2,
        message2,
      )
    })
  })

  describe("Channel Operations", () => {
    it("creates channel with correct context", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      adapter.testAddChannel("my-context")

      expect(adapter.generateCalls).toEqual(["my-context"])
      expect(adapter.lastGeneratedContext).toBe("my-context")
    })

    it("creates multiple channels with different contexts", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      adapter.testAddChannel("context-1")
      adapter.testAddChannel("context-2")
      adapter.testAddChannel("context-3")

      expect(adapter.generateCalls).toEqual([
        "context-1",
        "context-2",
        "context-3",
      ])
      expect(adapter.channels.size).toBe(3)
    })

    it("assigns unique channelIds to each channel", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      expect(channel1.channelId).not.toBe(channel2.channelId)
      expect(channel2.channelId).not.toBe(channel3.channelId)
      expect(channel1.channelId).not.toBe(channel3.channelId)
    })

    it("removes specific channel by id", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      adapter.testRemoveChannel(channel2.channelId)

      expect(adapter.channels.size).toBe(2)
      expect(adapter.channels.get(channel1.channelId)).toBe(channel1)
      expect(adapter.channels.get(channel2.channelId)).toBeUndefined()
      expect(adapter.channels.get(channel3.channelId)).toBe(channel3)
    })

    it("clears all channels on stop", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      adapter.testAddChannel("context-1")
      adapter.testAddChannel("context-2")
      adapter.testAddChannel("context-3")

      expect(adapter.channels.size).toBe(3)

      await adapter._stop()

      expect(adapter.channels.size).toBe(0)
    })
  })

  describe("_send Method", () => {
    it("sends message to matching channels", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const sendSpy1 = vi.spyOn(channel1, "send")
      const sendSpy2 = vi.spyOn(channel2, "send")

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      const sentCount = adapter._send({
        toChannelIds: [channel1.channelId],
        message,
      })

      expect(sentCount).toBe(1)
      expect(sendSpy1).toHaveBeenCalledWith(message)
      expect(sendSpy2).not.toHaveBeenCalled()
    })

    it("sends message to multiple matching channels", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      const sendSpy1 = vi.spyOn(channel1, "send")
      const sendSpy2 = vi.spyOn(channel2, "send")
      const sendSpy3 = vi.spyOn(channel3, "send")

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      const sentCount = adapter._send({
        toChannelIds: [channel1.channelId, channel3.channelId],
        message,
      })

      expect(sentCount).toBe(2)
      expect(sendSpy1).toHaveBeenCalledWith(message)
      expect(sendSpy2).not.toHaveBeenCalled()
      expect(sendSpy3).toHaveBeenCalledWith(message)
    })

    it("returns 0 when no matching channels", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      const sentCount = adapter._send({
        toChannelIds: [999, 1000],
        message,
      })

      expect(sentCount).toBe(0)
    })

    it("calls onSend hook when set", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")
      const onSendSpy = vi.fn()
      adapter.onSend = onSendSpy

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      adapter._send({
        toChannelIds: [channel.channelId],
        message,
      })

      expect(onSendSpy).toHaveBeenCalledWith(
        adapter.adapterId,
        channel.channelId,
        message,
      )
    })

    it("works without onSend hook", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      expect(() =>
        adapter._send({
          toChannelIds: [channel.channelId],
          message,
        }),
      ).not.toThrow()
    })
  })

  describe("Abstract Method Implementation", () => {
    it("calls onStart when adapter starts", async () => {
      adapter._initialize(hooks)

      expect(adapter.onStartCalls).toBe(0)

      await adapter._start()

      expect(adapter.onStartCalls).toBe(1)
    })

    it("calls onStop when adapter stops", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      expect(adapter.onStopCalls).toBe(0)

      await adapter._stop()

      expect(adapter.onStopCalls).toBe(1)
    })

    it("calls generate for each channel creation", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      expect(adapter.generateCalls).toHaveLength(0)

      adapter.testAddChannel("context-1")
      expect(adapter.generateCalls).toHaveLength(1)

      adapter.testAddChannel("context-2")
      expect(adapter.generateCalls).toHaveLength(2)
    })

    it("allows addChannel to be called during onStart", async () => {
      // Create an adapter that adds a channel during onStart
      class OnStartChannelAdapter extends Adapter<string> {
        channelCreatedDuringStart = false

        protected generate(_context: string): GeneratedChannel {
          return {
            adapterId: this.adapterId,
            kind: "network",
            send: vi.fn(),
            stop: vi.fn(),
          }
        }

        async onStart(): Promise<void> {
          // This should work because state transitions to "started" before onStart is called
          this.addChannel("created-during-start")
          this.channelCreatedDuringStart = true
        }

        async onStop(): Promise<void> {
          // Cleanup
        }
      }

      const adapter = new OnStartChannelAdapter({ adapterId: "test-adapter" })
      const onStartHooks: AdapterHooks = {
        identity: { peerId: "0" satisfies PeerID, name: "test-peer" },
        onChannelAdded: vi.fn(),
        onChannelRemoved: vi.fn(),
        onChannelReceive: vi.fn(),
        onChannelEstablish: vi.fn(),
      }
      adapter._initialize(onStartHooks)

      // Should not throw
      await expect(adapter._start()).resolves.not.toThrow()

      // Verify channel was created
      expect(adapter.channelCreatedDuringStart).toBe(true)
      expect(adapter.channels.size).toBe(1)
      expect(onStartHooks.onChannelAdded).toHaveBeenCalledTimes(1)
    })
  })

  describe("Logger Integration", () => {
    it("creates logger with adapterId", () => {
      const customAdapter = new MockAdapter("custom-id")

      expect(customAdapter.logger).toBeDefined()
      // Logger should be configured with adapterId context
    })
  })

  describe("ChannelDirectory Integration", () => {
    it("uses ChannelDirectory for channel management", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      expect(adapter.channels).toBeDefined()
      expect(adapter.channels.size).toBe(0)

      adapter.testAddChannel("context-1")
      expect(adapter.channels.size).toBe(1)

      adapter.testAddChannel("context-2")
      expect(adapter.channels.size).toBe(2)
    })

    it("can iterate over channels", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const channels = Array.from(adapter.channels)

      expect(channels).toHaveLength(2)
      expect(channels).toContain(channel1)
      expect(channels).toContain(channel2)
    })

    it("can check if channel exists", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      expect(adapter.channels.has(channel.channelId)).toBe(true)
      expect(adapter.channels.has(999)).toBe(false)
    })

    it("can get channel by id", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      expect(adapter.channels.get(channel.channelId)).toBe(channel)
      expect(adapter.channels.get(999)).toBeUndefined()
    })
  })

  describe("Edge Cases", () => {
    it("handles rapid start/stop cycles", async () => {
      for (let i = 0; i < 5; i++) {
        adapter._initialize(hooks)
        await adapter._start()
        adapter.testAddChannel(`context-${i}`)
        await adapter._stop()
      }

      expect(adapter.onStartCalls).toBe(5)
      expect(adapter.onStopCalls).toBe(5)
      expect(adapter.channels.size).toBe(0)
    })

    it("handles empty toChannelIds in _send", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const message: ChannelMsg = {
        type: "channel/sync-request",
        docs: [],
      }

      const sentCount = adapter._send({
        toChannelIds: [],
        message,
      })

      expect(sentCount).toBe(0)
    })

    it("handles channel removal during iteration", async () => {
      adapter._initialize(hooks)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      // Remove middle channel
      adapter.testRemoveChannel(channel2.channelId)

      const remaining = Array.from(adapter.channels)
      expect(remaining).toHaveLength(2)
      expect(remaining).toContain(channel1)
      expect(remaining).toContain(channel3)
    })
  })
})
