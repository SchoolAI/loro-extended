/**
 * Tests for the SSE client network adapter.
 */

import type { AdapterContext, PeerID } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SseClientNetworkAdapter } from "../client.js"

// Store the current mock instance
let currentMockEventSource: {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close: ReturnType<typeof vi.fn>
} | null = null

vi.mock("reconnecting-eventsource", () => ({
  default: vi.fn().mockImplementation(() => {
    currentMockEventSource = {
      readyState: 1, // OPEN
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    }
    return currentMockEventSource
  }),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Create a mock logger for tests
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  getChild: vi.fn().mockReturnThis(),
  with: vi.fn().mockReturnThis(),
} as any

describe("SseClientNetworkAdapter", () => {
  let adapter: SseClientNetworkAdapter
  let context: AdapterContext

  beforeEach(() => {
    vi.clearAllMocks()
    currentMockEventSource = null
    mockFetch.mockResolvedValue({ ok: true })

    adapter = new SseClientNetworkAdapter({
      postUrl: "/loro/sync",
      eventSourceUrl: peerId => `/loro/events?peerId=${peerId}`,
    })

    context = {
      identity: {
        peerId: "123456789" as PeerID,
        name: "test-peer",
        type: "user",
      },
      logger: mockLogger,
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    }
  })

  describe("Initialization", () => {
    it("creates adapter with correct type", () => {
      expect(adapter.adapterType).toBe("sse-client")
    })

    it("initializes with postUrl and eventSourceUrl", async () => {
      adapter._initialize(context)
      await adapter._start()

      // EventSource should be created
      expect(currentMockEventSource).not.toBeNull()

      // Trigger onopen to create channel
      currentMockEventSource?.onopen?.(new Event("open"))

      expect(adapter.channels.size).toBe(1)
    })

    it("supports function-based URLs", async () => {
      const postUrlFn = vi.fn((peerId: PeerID) => `/api/${peerId}/sync`)
      const eventSourceUrlFn = vi.fn(
        (peerId: PeerID) => `/api/${peerId}/events`,
      )

      adapter = new SseClientNetworkAdapter({
        postUrl: postUrlFn,
        eventSourceUrl: eventSourceUrlFn,
      })

      adapter._initialize(context)
      await adapter._start()

      expect(eventSourceUrlFn).toHaveBeenCalledWith("123456789")
    })
  })

  describe("EventSource Lifecycle", () => {
    it("creates EventSource on start", async () => {
      adapter._initialize(context)
      await adapter._start()

      // EventSource should be created with handlers
      expect(currentMockEventSource).not.toBeNull()
      expect(currentMockEventSource?.onopen).toBeDefined()
      expect(currentMockEventSource?.onmessage).toBeDefined()
      expect(currentMockEventSource?.onerror).toBeDefined()
    })

    it("creates channel on EventSource open", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.channels.size).toBe(0)

      // Simulate EventSource open
      currentMockEventSource?.onopen?.(new Event("open"))

      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)
    })

    it("does NOT remove channel on single EventSource error", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel first
      currentMockEventSource?.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)

      // Simulate error
      currentMockEventSource?.onerror?.(new Event("error"))

      // Channel should still exist (waiting for max attempts)
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelRemoved).toHaveBeenCalledTimes(0)
    })

    it("closes EventSource on stop", async () => {
      adapter._initialize(context)
      await adapter._start()

      currentMockEventSource?.onopen?.(new Event("open"))

      await adapter._stop()

      expect(currentMockEventSource?.close).toHaveBeenCalled()
      expect(adapter.channels.size).toBe(0)
    })
  })

  describe("Reconnection Logic", () => {
    it("triggers reconnection when EventSource is closed before send", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Store reference to the old EventSource before it gets replaced
      if (!currentMockEventSource) {
        throw new Error("EventSource should be created")
      }
      const oldEventSource = currentMockEventSource

      // Simulate EventSource being closed
      currentMockEventSource.readyState = 2 // CLOSED

      // Try to send a message
      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      // Send should trigger reconnection, not throw
      await channel.send(message)

      // Should have closed the old EventSource
      expect(oldEventSource.close).toHaveBeenCalled()
    })

    it("does not send message when EventSource is closed", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Simulate EventSource being closed
      if (!currentMockEventSource) {
        throw new Error("EventSource should be created")
      }
      currentMockEventSource.readyState = 2 // CLOSED

      // Try to send a message
      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await channel.send(message)

      // Fetch should NOT have been called because we detected closed state
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("sends message when EventSource is open", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // EventSource is open (readyState = 1)
      if (!currentMockEventSource) {
        throw new Error("EventSource should be created")
      }
      currentMockEventSource.readyState = 1

      // Send a message
      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await channel.send(message)

      // Fetch should have been called
      expect(mockFetch).toHaveBeenCalledWith(
        "/loro/sync",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Peer-Id": "123456789",
          }),
        }),
      )
    })

    it("preserves channel on reconnection", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create initial channel
      currentMockEventSource?.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Simulate reconnection by triggering onopen again
      currentMockEventSource?.onopen?.(new Event("open"))

      // Should preserve existing channel
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelRemoved).toHaveBeenCalledTimes(0)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)
      expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
    })
  })

  describe("Message Handling", () => {
    it("receives messages from EventSource", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource?.onopen?.(new Event("open"))

      // Simulate receiving a message
      const messageData = {
        type: "channel/establish-response",
        identity: { peerId: "server-peer", name: "Server", type: "service" },
      }

      currentMockEventSource?.onmessage?.({
        data: JSON.stringify(messageData),
      } as MessageEvent)

      expect(context.onChannelReceive).toHaveBeenCalledTimes(1)
    })

    it("logs warning when receiving message without channel", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Don't create channel (don't trigger onopen)

      // Try to receive a message
      const messageData = {
        type: "channel/establish-response",
        identity: { peerId: "server-peer", name: "Server", type: "service" },
      }

      currentMockEventSource?.onmessage?.({
        data: JSON.stringify(messageData),
      } as MessageEvent)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Received message but server channel is not available",
      )
    })
  })

  describe("Error Handling", () => {
    it("throws when sending without peerId", async () => {
      adapter._initialize(context)
      await adapter._start()

      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Manually clear peerId to simulate uninitialized state
      ;(adapter as any).peerId = undefined

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await expect(channel.send(message)).rejects.toThrow(
        "Adapter not initialized - peerId not available",
      )
    })

    it("throws when fetch fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      })

      adapter._initialize(context)
      await adapter._start()

      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await expect(channel.send(message)).rejects.toThrow(
        "Server error: Internal Server Error",
      )
    })
  })

  describe("Connection State Tracking", () => {
    it("starts in 'disconnected' state before initialization", () => {
      const adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
      })

      expect(adapter.connectionState).toBe("disconnected")
    })

    it("transitions to 'connecting' when setupEventSource is called", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Before onopen fires
      expect(adapter.connectionState).toBe("connecting")
    })

    it("transitions to 'connected' when EventSource opens", async () => {
      adapter._initialize(context)
      await adapter._start()

      currentMockEventSource?.onopen?.(new Event("open"))

      expect(adapter.connectionState).toBe("connected")
    })

    it("transitions to 'reconnecting' on error (not 'disconnected')", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      // Simulate error
      currentMockEventSource?.onerror?.(new Event("error"))

      expect(adapter.connectionState).toBe("reconnecting")
      // Channel should NOT be removed yet
      expect(adapter.channels.size).toBe(1)
    })

    it("returns to 'connected' when EventSource reconnects after error", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      // Simulate error then reconnect
      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.connectionState).toBe("reconnecting")

      currentMockEventSource?.onopen?.(new Event("open"))
      expect(adapter.connectionState).toBe("connected")
    })
  })

  describe("Reconnect Attempt Tracking", () => {
    it("increments reconnectAttempts on each error", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      expect(adapter.reconnectAttempts).toBe(0)

      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(1)

      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(2)
    })

    it("resets reconnectAttempts to 0 on successful reconnection", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      // Simulate multiple errors
      currentMockEventSource?.onerror?.(new Event("error"))
      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(2)

      // Successful reconnection
      currentMockEventSource?.onopen?.(new Event("open"))
      expect(adapter.reconnectAttempts).toBe(0)
    })

    it("does NOT remove channel until maxAttempts is reached", async () => {
      adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
        reconnect: { maxAttempts: 3 },
      })
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      // First two errors - channel should remain
      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(1)

      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(1)

      // Third error - max reached, channel should be removed
      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(0)
      expect(adapter.connectionState).toBe("disconnected")
    })
  })

  describe("Channel Preservation During Reconnection", () => {
    it("keeps the same channel during reconnection attempts", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Error occurs
      currentMockEventSource?.onerror?.(new Event("error"))

      // Channel should still exist with same ID
      expect(adapter.channels.size).toBe(1)
      expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
    })

    it("preserves channel when reconnect() is triggered by send on closed socket", async () => {
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Simulate closed socket
      if (currentMockEventSource) currentMockEventSource.readyState = 2 // CLOSED

      // Trigger send, which triggers reconnect()
      const channel = Array.from(adapter.channels)[0]
      await channel.send({
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      })

      // Channel should still exist
      expect(adapter.channels.size).toBe(1)
      expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
      expect(adapter.connectionState).toBe("reconnecting")
    })

    it("creates new channel only after successful reconnection following max attempts", async () => {
      adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
        reconnect: { maxAttempts: 2 },
      })
      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Max attempts reached - channel removed
      currentMockEventSource?.onerror?.(new Event("error"))
      currentMockEventSource?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(0)

      // New connection - new channel
      currentMockEventSource?.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)
      expect(Array.from(adapter.channels)[0].channelId).not.toBe(
        originalChannelId,
      )
    })
  })

  describe("POST Retry on Network Errors", () => {
    it("retries on TypeError (network error)", async () => {
      // First call fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ ok: true })

      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await channel.send(message)

      // Should have been called twice
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it("retries up to maxAttempts times on network errors", async () => {
      adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
        postRetry: { maxAttempts: 3 },
      })

      // All calls fail with network error
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))

      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await expect(channel.send(message)).rejects.toThrow("Failed to fetch")

      // Should have been called 3 times
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe("POST Retry Exponential Backoff", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("waits baseDelay before first retry", async () => {
      adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
        postRetry: { baseDelay: 1000 },
      })

      mockFetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ ok: true })

      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const sendPromise = channel.send({
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      })

      // First call happens immediately
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time by 999ms - retry should not have happened yet
      await vi.advanceTimersByTimeAsync(999)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance to 1000ms - retry should happen (plus jitter up to 100ms)
      await vi.advanceTimersByTimeAsync(101)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      await sendPromise
    })

    it("cancels pending retry when EventSource reconnects", async () => {
      adapter = new SseClientNetworkAdapter({
        postUrl: "/sync",
        eventSourceUrl: "/events",
        postRetry: { baseDelay: 1000 },
      })

      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))

      adapter._initialize(context)
      await adapter._start()
      currentMockEventSource?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const sendPromise = channel.send({
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      })

      // First call happens immediately
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Simulate EventSource reconnect before retry happens
      currentMockEventSource?.onopen?.(new Event("open"))

      // Advance time past retry delay AND wait for rejection
      // We use Promise.all to ensure we catch the rejection as it happens
      await Promise.all([
        expect(sendPromise).rejects.toThrow(),
        vi.advanceTimersByTimeAsync(2000),
      ])

      // Should NOT have retried because it was cancelled
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})
