import { getLogger } from "@logtape/logtape"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import type { AdapterType, PeerID } from "../types.js"
import { Adapter, type AdapterContext } from "./adapter.js"
import type { SendInterceptorContext } from "./interceptor.js"

// Create a mock logger for tests
const mockLogger = getLogger(["test"])

// Mock adapter for testing
class MockAdapter extends Adapter<string> {
  onStartCalls = 0
  onStopCalls = 0
  generateCalls: string[] = []

  // Track what was passed to generate
  lastGeneratedContext: string | undefined

  constructor(adapterType: AdapterType = "mock-adapter") {
    super({ adapterType })
  }

  protected generate(context: string): GeneratedChannel {
    this.generateCalls.push(context)
    this.lastGeneratedContext = context

    return {
      adapterType: this.adapterType,
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
  let context: AdapterContext

  beforeEach(() => {
    adapter = new MockAdapter()
    context = {
      identity: { peerId: "0", name: "test-peer", type: "user" },
      logger: mockLogger,
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    } as AdapterContext
  })

  describe("Lifecycle State Management", () => {
    it("starts in 'created' state", () => {
      expect(adapter).toBeDefined()
      expect(adapter.adapterType).toBe("mock-adapter")
    })

    it("transitions from 'created' to 'initialized' on _initialize", () => {
      adapter._initialize(context)
      // State is internal, but we can verify behavior by checking that
      // re-initialization auto-stops and succeeds (HMR resilience)
      expect(() => adapter._initialize(context)).not.toThrow()
    })

    it("transitions from 'initialized' to 'started' on _start", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.onStartCalls).toBe(1)
    })

    it("transitions from 'started' to 'stopped' on _stop", async () => {
      adapter._initialize(context)
      await adapter._start()
      await adapter._stop()

      expect(adapter.onStopCalls).toBe(1)
      expect(adapter.channels.size).toBe(0)
    })

    it("allows re-initialization after stop (for test reuse)", async () => {
      adapter._initialize(context)
      await adapter._start()
      await adapter._stop()

      // Should allow re-initialization
      expect(() => adapter._initialize(context)).not.toThrow()
    })

    it("throws when starting without initialization", async () => {
      await expect(adapter._start()).rejects.toThrow(
        "Cannot start adapter mock-adapter",
      )
    })

    it("auto-stops and re-initializes when initializing twice (HMR resilience)", () => {
      adapter._initialize(context)

      // Should auto-stop and allow re-initialization (for HMR scenarios)
      expect(() => adapter._initialize(context)).not.toThrow()
    })

    it("auto-stops from started state when re-initializing (HMR resilience)", async () => {
      adapter._initialize(context)
      await adapter._start()
      adapter.testAddChannel("test-context")
      expect(adapter.channels.size).toBe(1)

      // Re-initialize should auto-stop, clearing channels
      adapter._initialize(context)
      expect(adapter.channels.size).toBe(0)
    })

    it("warns when stopping from non-started state", async () => {
      const warnSpy = vi.spyOn(adapter.logger, "warn")

      await adapter._stop()

      expect(warnSpy).toHaveBeenCalledWith(
        "Stopping adapter {adapterType} in unexpected state: {state.state}",
        expect.objectContaining({
          adapterType: "mock-adapter",
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
        adapter._initialize(context)

        expect(() => adapter.testAddChannel("test-context")).toThrow(
          "can't add channel in 'initialized' state (must be 'started')",
        )
      })

      it("succeeds when called in 'started' state", async () => {
        adapter._initialize(context)
        await adapter._start()

        const channel = adapter.testAddChannel("test-context")

        expect(channel).toBeDefined()
        expect(channel.channelId).toBeDefined()
        expect(adapter.channels.size).toBe(1)
      })

      it("throws when called after stop", async () => {
        adapter._initialize(context)
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
        adapter._initialize(context)

        expect(() => adapter.testRemoveChannel(1)).toThrow(
          "can't remove channel in 'initialized' state (must be 'started')",
        )
      })

      it("succeeds when called in 'started' state", async () => {
        adapter._initialize(context)
        await adapter._start()

        const channel = adapter.testAddChannel("test-context")
        const removed = adapter.testRemoveChannel(channel.channelId)

        expect(removed).toBe(channel)
        expect(adapter.channels.size).toBe(0)
      })

      it("throws when called after stop", async () => {
        adapter._initialize(context)
        await adapter._start()
        await adapter._stop()

        expect(() => adapter.testRemoveChannel(1)).toThrow(
          "can't remove channel in 'stopped' state (must be 'started')",
        )
      })

      it("returns undefined when channel not found", async () => {
        adapter._initialize(context)
        await adapter._start()

        const removed = adapter.testRemoveChannel(999)

        expect(removed).toBeUndefined()
      })
    })
  })

  describe("Hook Integration", () => {
    it("calls onChannelAdded hook when channel is added", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")

      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)
      expect(context.onChannelAdded).toHaveBeenCalledWith(channel)
    })

    it("calls onChannelRemoved hook when channel is removed", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")
      adapter.testRemoveChannel(channel.channelId)

      expect(context.onChannelRemoved).toHaveBeenCalledTimes(1)
      expect(context.onChannelRemoved).toHaveBeenCalledWith(channel)
    })

    it("does not call onChannelRemoved when channel not found", async () => {
      adapter._initialize(context)
      await adapter._start()

      adapter.testRemoveChannel(999)

      expect(context.onChannelRemoved).not.toHaveBeenCalled()
    })

    it("calls onChannelReceive hook when channel receives message", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")
      const message: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "1", name: "test-peer", type: "user" },
      }

      channel.onReceive(message)

      expect(context.onChannelReceive).toHaveBeenCalledTimes(1)
      // Note: onChannelReceive now receives channelId instead of channel object
      expect(context.onChannelReceive).toHaveBeenCalledWith(
        channel.channelId,
        message,
      )
    })

    it("hooks are available in 'started' state", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Add multiple channels and verify hooks work for all
      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      expect(context.onChannelAdded).toHaveBeenCalledTimes(2)

      adapter.testRemoveChannel(channel1.channelId)
      adapter.testRemoveChannel(channel2.channelId)

      expect(context.onChannelRemoved).toHaveBeenCalledTimes(2)
    })

    it("uses hooks from lifecycle state at time of channel creation", async () => {
      // This tests that hooks are captured in closures correctly
      adapter._initialize(context)
      await adapter._start()

      adapter.testAddChannel("test-context")

      // Create new context
      const newContext = {
        identity: {
          peerId: "0" satisfies PeerID,
          name: "test-peer",
          type: "user",
        },
        logger: mockLogger,
        onChannelAdded: vi.fn(),
        onChannelRemoved: vi.fn(),
        onChannelReceive: vi.fn(),
        onChannelEstablish: vi.fn(),
      } as AdapterContext

      // Stop and re-initialize with new context
      await adapter._stop()
      adapter._initialize(newContext)
      await adapter._start()

      // The old channel's onReceive should still use the OLD hooks
      // (this verifies closure behavior)
      const message: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "2", name: "test-peer", type: "user" },
      }

      // Note: After stop, the old channel is cleared, so we create a new one
      const newChannel = adapter.testAddChannel("new-context")
      newChannel.onReceive(message)

      // New context should be called for new channel (with channelId)
      expect(newContext.onChannelReceive).toHaveBeenCalledWith(
        newChannel.channelId,
        message,
      )
      expect(context.onChannelReceive).not.toHaveBeenCalled()
    })

    it("channel.onReceive is properly wired to lifecycle hook", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("test-context")

      // Verify the channel has an onReceive handler
      expect(channel.onReceive).toBeDefined()
      expect(typeof channel.onReceive).toBe("function")

      // Call it and verify it triggers the lifecycle hook
      const message: ChannelMsg = {
        type: "channel/directory-request",
      }

      channel.onReceive(message)

      // Should call the lifecycle's onChannelReceive with the channelId and message
      expect(context.onChannelReceive).toHaveBeenCalledTimes(1)
      expect(context.onChannelReceive).toHaveBeenCalledWith(
        channel.channelId,
        message,
      )
    })

    it("multiple channels each have their own onReceive wired correctly", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const message1: ChannelMsg = {
        type: "channel/establish-request",
        identity: { peerId: "1", name: "peer-1", type: "user" },
      }

      const message2: ChannelMsg = {
        type: "channel/establish-response",
        identity: { peerId: "2", name: "peer-2", type: "user" },
      }

      channel1.onReceive(message1)
      channel2.onReceive(message2)

      expect(context.onChannelReceive).toHaveBeenCalledTimes(2)
      expect(context.onChannelReceive).toHaveBeenNthCalledWith(
        1,
        channel1.channelId,
        message1,
      )
      expect(context.onChannelReceive).toHaveBeenNthCalledWith(
        2,
        channel2.channelId,
        message2,
      )
    })
  })

  describe("Channel Operations", () => {
    it("creates channel with correct context", async () => {
      adapter._initialize(context)
      await adapter._start()

      adapter.testAddChannel("my-context")

      expect(adapter.generateCalls).toEqual(["my-context"])
      expect(adapter.lastGeneratedContext).toBe("my-context")
    })

    it("creates multiple channels with different contexts", async () => {
      adapter._initialize(context)
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
      adapter._initialize(context)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      expect(channel1.channelId).not.toBe(channel2.channelId)
      expect(channel2.channelId).not.toBe(channel3.channelId)
      expect(channel1.channelId).not.toBe(channel3.channelId)
    })

    it("removes specific channel by id", async () => {
      adapter._initialize(context)
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
      adapter._initialize(context)
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
      adapter._initialize(context)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const sendSpy1 = vi.spyOn(channel1, "send")
      const sendSpy2 = vi.spyOn(channel2, "send")

      const message: ChannelMsg = {
        type: "channel/directory-request",
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
      adapter._initialize(context)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")
      const channel3 = adapter.testAddChannel("context-3")

      const sendSpy1 = vi.spyOn(channel1, "send")
      const sendSpy2 = vi.spyOn(channel2, "send")
      const sendSpy3 = vi.spyOn(channel3, "send")

      const message: ChannelMsg = {
        type: "channel/directory-request",
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
      adapter._initialize(context)
      await adapter._start()

      const message: ChannelMsg = {
        type: "channel/directory-request",
      }

      const sentCount = adapter._send({
        toChannelIds: [999, 1000],
        message,
      })

      expect(sentCount).toBe(0)
    })

    it("calls onSend hook when set", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")
      const onSendSpy = vi.fn()
      adapter.onSend = onSendSpy

      const message: ChannelMsg = {
        type: "channel/directory-request",
      }

      adapter._send({
        toChannelIds: [channel.channelId],
        message,
      })

      expect(onSendSpy).toHaveBeenCalledWith(
        adapter.adapterType,
        channel.channelId,
        message,
      )
    })

    it("works without onSend hook", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      const message: ChannelMsg = {
        type: "channel/directory-request",
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
      adapter._initialize(context)

      expect(adapter.onStartCalls).toBe(0)

      await adapter._start()

      expect(adapter.onStartCalls).toBe(1)
    })

    it("calls onStop when adapter stops", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.onStopCalls).toBe(0)

      await adapter._stop()

      expect(adapter.onStopCalls).toBe(1)
    })

    it("calls generate for each channel creation", async () => {
      adapter._initialize(context)
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
            adapterType: this.adapterType,
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

      const adapter = new OnStartChannelAdapter({ adapterType: "test-adapter" })
      const onStartContext = {
        identity: {
          peerId: "0" satisfies PeerID,
          name: "test-peer",
          type: "user",
        },
        logger: mockLogger,
        onChannelAdded: vi.fn(),
        onChannelRemoved: vi.fn(),
        onChannelReceive: vi.fn(),
        onChannelEstablish: vi.fn(),
      } as AdapterContext
      adapter._initialize(onStartContext)

      // Should not throw
      await expect(adapter._start()).resolves.not.toThrow()

      // Verify channel was created
      expect(adapter.channelCreatedDuringStart).toBe(true)
      expect(adapter.channels.size).toBe(1)
      expect(onStartContext.onChannelAdded).toHaveBeenCalledTimes(1)
    })
  })

  describe("Logger Integration", () => {
    it("creates logger with adapterType", () => {
      const customAdapter = new MockAdapter("custom-id")

      expect(customAdapter.logger).toBeDefined()
      // Logger should be configured with adapterType context
    })

    it("updates logger during initialization", () => {
      adapter._initialize(context)

      // After initialization, the logger should be derived from the context logger
      expect(adapter.logger).toBeDefined()
    })
  })

  describe("ChannelDirectory Integration", () => {
    it("uses ChannelDirectory for channel management", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.channels).toBeDefined()
      expect(adapter.channels.size).toBe(0)

      adapter.testAddChannel("context-1")
      expect(adapter.channels.size).toBe(1)

      adapter.testAddChannel("context-2")
      expect(adapter.channels.size).toBe(2)
    })

    it("can iterate over channels", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      const channels = Array.from(adapter.channels)

      expect(channels).toHaveLength(2)
      expect(channels).toContain(channel1)
      expect(channels).toContain(channel2)
    })

    it("can check if channel exists", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      expect(adapter.channels.has(channel.channelId)).toBe(true)
      expect(adapter.channels.has(999)).toBe(false)
    })

    it("can get channel by id", async () => {
      adapter._initialize(context)
      await adapter._start()

      const channel = adapter.testAddChannel("context-1")

      expect(adapter.channels.get(channel.channelId)).toBe(channel)
      expect(adapter.channels.get(999)).toBeUndefined()
    })
  })

  describe("Edge Cases", () => {
    it("handles rapid start/stop cycles", async () => {
      for (let i = 0; i < 5; i++) {
        adapter._initialize(context)
        await adapter._start()
        adapter.testAddChannel(`context-${i}`)
        await adapter._stop()
      }

      expect(adapter.onStartCalls).toBe(5)
      expect(adapter.onStopCalls).toBe(5)
      expect(adapter.channels.size).toBe(0)
    })

    it("handles empty toChannelIds in _send", async () => {
      adapter._initialize(context)
      await adapter._start()

      const message: ChannelMsg = {
        type: "channel/directory-request",
      }

      const sentCount = adapter._send({
        toChannelIds: [],
        message,
      })

      expect(sentCount).toBe(0)
    })

    it("handles channel removal during iteration", async () => {
      adapter._initialize(context)
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

  describe("adapterId", () => {
    it("auto-generates unique adapterId when not provided", () => {
      const adapter1 = new MockAdapter("test")
      const adapter2 = new MockAdapter("test")

      expect(adapter1.adapterId).toMatch(/^test-/)
      expect(adapter2.adapterId).toMatch(/^test-/)
      expect(adapter1.adapterId).not.toBe(adapter2.adapterId)
    })

    it("uses provided adapterId", () => {
      class AdapterWithId extends Adapter<string> {
        constructor(adapterType: string, adapterId: string) {
          super({ adapterType, adapterId })
        }

        protected generate(): GeneratedChannel {
          return {
            adapterType: this.adapterType,
            kind: "network",
            send: vi.fn(),
            stop: vi.fn(),
          }
        }

        async onStart(): Promise<void> {}
        async onStop(): Promise<void> {}
      }

      const adapter = new AdapterWithId("test", "my-custom-id")

      expect(adapter.adapterId).toBe("my-custom-id")
    })

    it("adapterId format is {adapterType}-{uuid} when auto-generated", () => {
      const adapter = new MockAdapter("my-type")

      expect(adapter.adapterId).toMatch(/^my-type-[a-f0-9-]+$/)
    })
  })

  describe("Send Interceptors", () => {
    it("calls interceptor before sending", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      const interceptorCalls: string[] = []
      adapter.addSendInterceptor((ctx, next) => {
        interceptorCalls.push(ctx.envelope.message.type)
        next()
      })

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })

      expect(interceptorCalls).toEqual(["channel/directory-request"])
      expect(sendSpy).toHaveBeenCalled()
    })

    it("drops message when next() is not called", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      adapter.addSendInterceptor((_ctx, _next) => {
        // Don't call next - message is dropped
      })

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })

      expect(sendSpy).not.toHaveBeenCalled()
    })

    it("delays message when next() is called asynchronously", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      adapter.addSendInterceptor((_ctx, next) => {
        setTimeout(next, 50)
      })

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })

      // Not sent immediately
      expect(sendSpy).not.toHaveBeenCalled()

      // Sent after delay
      await vi.waitFor(() => expect(sendSpy).toHaveBeenCalled())
    })

    it("chains multiple interceptors in order", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")

      const order: number[] = []
      adapter.addSendInterceptor((_ctx, next) => {
        order.push(1)
        next()
      })
      adapter.addSendInterceptor((_ctx, next) => {
        order.push(2)
        next()
      })
      adapter.addSendInterceptor((_ctx, next) => {
        order.push(3)
        next()
      })

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })

      expect(order).toEqual([1, 2, 3])
    })

    it("removes interceptor when unsubscribe is called", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      const unsubscribe = adapter.addSendInterceptor((_ctx, _next) => {
        // Drop all messages
      })

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })
      expect(sendSpy).not.toHaveBeenCalled()

      unsubscribe()

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })
      expect(sendSpy).toHaveBeenCalled()
    })

    it("clears all interceptors with clearSendInterceptors()", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      adapter.addSendInterceptor((_ctx, _next) => {})
      adapter.addSendInterceptor((_ctx, _next) => {})

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })
      expect(sendSpy).not.toHaveBeenCalled()

      adapter.clearSendInterceptors()

      adapter._send({
        toChannelIds: [channel.channelId],
        message: { type: "channel/directory-request" },
      })
      expect(sendSpy).toHaveBeenCalled()
    })

    it("provides context with envelope, adapterType, and adapterId", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")

      let capturedContext: SendInterceptorContext | undefined
      adapter.addSendInterceptor((ctx, next) => {
        capturedContext = ctx
        next()
      })

      const message: ChannelMsg = { type: "channel/directory-request" }
      adapter._send({
        toChannelIds: [channel.channelId],
        message,
      })

      expect(capturedContext).toBeDefined()
      if (capturedContext) {
        expect(capturedContext.envelope.message).toBe(message)
        expect(capturedContext.adapterType).toBe("mock-adapter")
        expect(capturedContext.adapterId).toMatch(/^mock-adapter-/)
      }
    })

    it("uses fast path when no interceptors are present", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel = adapter.testAddChannel("context-1")
      const sendSpy = vi.spyOn(channel, "send")

      const message: ChannelMsg = { type: "channel/directory-request" }
      const sentCount = adapter._send({
        toChannelIds: [channel.channelId],
        message,
      })

      expect(sentCount).toBe(1)
      expect(sendSpy).toHaveBeenCalledWith(message)
    })

    it("returns optimistic count when interceptors are present", async () => {
      adapter._initialize(context)
      await adapter._start()
      const channel1 = adapter.testAddChannel("context-1")
      const channel2 = adapter.testAddChannel("context-2")

      adapter.addSendInterceptor((_ctx, _next) => {
        // Drop all messages
      })

      const sentCount = adapter._send({
        toChannelIds: [channel1.channelId, channel2.channelId],
        message: { type: "channel/directory-request" },
      })

      // Returns optimistic count even though messages are dropped
      expect(sentCount).toBe(2)
    })
  })
})
