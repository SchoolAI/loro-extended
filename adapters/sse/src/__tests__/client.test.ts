/**
 * Tests for the SSE client network adapter.
 */

import type {
  AdapterContext,
  ChannelMsgSyncRequest,
  PeerID,
} from "@loro-extended/repo"
import { VersionVector } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SseClientNetworkAdapter } from "../client.js"

// Helper to create a valid sync-request message
function createSyncRequest(): ChannelMsgSyncRequest {
  return {
    type: "channel/sync-request",
    docId: "test-doc",
    requesterDocVersion: new VersionVector(null),
    bidirectional: false,
  }
}

// Type for the mock EventSource
type MockEventSourceType = {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close: ReturnType<typeof vi.fn>
}

// Store the current mock instance - use globalThis to share between hoisted mock and test code
declare global {
  // eslint-disable-next-line no-var
  var __mockEventSource: MockEventSourceType | null
}

globalThis.__mockEventSource = null

// Helper to get the current mock event source
const mockES = () => globalThis.__mockEventSource

vi.mock("reconnecting-eventsource", () => {
  // Mock class for ReconnectingEventSource (vitest v4 requires class/function for constructors)
  return {
    default: class MockReconnectingEventSource {
      readyState = 1 // OPEN
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      close = vi.fn()

      constructor() {
        globalThis.__mockEventSource = this
      }
    },
  }
})

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
    globalThis.__mockEventSource = null
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
      expect(mockES()).not.toBeNull()

      // Trigger onopen to create channel
      mockES()?.onopen?.(new Event("open"))

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
      expect(mockES()).not.toBeNull()
      expect(mockES()?.onopen).toBeDefined()
      expect(mockES()?.onmessage).toBeDefined()
      expect(mockES()?.onerror).toBeDefined()
    })

    it("creates channel on EventSource open", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.channels.size).toBe(0)

      // Simulate EventSource open
      mockES()?.onopen?.(new Event("open"))

      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)
    })

    it("does NOT remove channel on single EventSource error", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel first
      mockES()?.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)

      // Simulate error
      mockES()?.onerror?.(new Event("error"))

      // Channel should still exist (waiting for max attempts)
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelRemoved).toHaveBeenCalledTimes(0)
    })

    it("closes EventSource on stop", async () => {
      adapter._initialize(context)
      await adapter._start()

      mockES()?.onopen?.(new Event("open"))

      await adapter._stop()

      expect(mockES()?.close).toHaveBeenCalled()
      expect(adapter.channels.size).toBe(0)
    })
  })

  describe("Reconnection Logic", () => {
    it("triggers reconnection when EventSource is closed before send", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Store reference to the old EventSource before it gets replaced
      const es = mockES()
      if (!es) {
        throw new Error("EventSource should be created")
      }
      const oldEventSource = es

      // Simulate EventSource being closed
      es.readyState = 2 // CLOSED

      // Try to send a message - Send should trigger reconnection, not throw
      await channel.send(createSyncRequest())

      // Should have closed the old EventSource
      expect(oldEventSource.close).toHaveBeenCalled()
    })

    it("does not send message when EventSource is closed", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Simulate EventSource being closed
      const es = mockES()
      if (!es) {
        throw new Error("EventSource should be created")
      }
      es.readyState = 2 // CLOSED

      // Try to send a message
      await channel.send(createSyncRequest())

      // Fetch should NOT have been called because we detected closed state
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("sends message when EventSource is open", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // EventSource is open (readyState = 1)
      const es = mockES()
      if (!es) {
        throw new Error("EventSource should be created")
      }
      es.readyState = 1

      // Send a message
      await channel.send(createSyncRequest())

      // Fetch should have been called with binary CBOR content
      expect(mockFetch).toHaveBeenCalledWith(
        "/loro/sync",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/octet-stream",
            "X-Peer-Id": "123456789",
          }),
          body: expect.any(Blob),
        }),
      )
    })

    it("preserves channel on reconnection", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create initial channel
      mockES()?.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Simulate reconnection by triggering onopen again
      mockES()?.onopen?.(new Event("open"))

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
      mockES()?.onopen?.(new Event("open"))

      // Simulate receiving a message
      const messageData = {
        type: "channel/establish-response",
        identity: { peerId: "server-peer", name: "Server", type: "service" },
      }

      mockES()?.onmessage?.({
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

      mockES()?.onmessage?.({
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

      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Manually clear peerId to simulate uninitialized state
      ;(adapter as any).peerId = undefined

      await expect(channel.send(createSyncRequest())).rejects.toThrow(
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

      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      await expect(channel.send(createSyncRequest())).rejects.toThrow(
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

      mockES()?.onopen?.(new Event("open"))

      expect(adapter.connectionState).toBe("connected")
    })

    it("transitions to 'reconnecting' on error (not 'disconnected')", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      // Simulate error
      mockES()?.onerror?.(new Event("error"))

      expect(adapter.connectionState).toBe("reconnecting")
      // Channel should NOT be removed yet
      expect(adapter.channels.size).toBe(1)
    })

    it("returns to 'connected' when EventSource reconnects after error", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      // Simulate error then reconnect
      mockES()?.onerror?.(new Event("error"))
      expect(adapter.connectionState).toBe("reconnecting")

      mockES()?.onopen?.(new Event("open"))
      expect(adapter.connectionState).toBe("connected")
    })
  })

  describe("Reconnect Attempt Tracking", () => {
    it("increments reconnectAttempts on each error", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      expect(adapter.reconnectAttempts).toBe(0)

      mockES()?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(1)

      mockES()?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(2)
    })

    it("resets reconnectAttempts to 0 on successful reconnection", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      // Simulate multiple errors
      mockES()?.onerror?.(new Event("error"))
      mockES()?.onerror?.(new Event("error"))
      expect(adapter.reconnectAttempts).toBe(2)

      // Successful reconnection
      mockES()?.onopen?.(new Event("open"))
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
      mockES()?.onopen?.(new Event("open"))

      // First two errors - channel should remain
      mockES()?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(1)

      mockES()?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(1)

      // Third error - max reached, channel should be removed
      mockES()?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(0)
      expect(adapter.connectionState).toBe("disconnected")
    })
  })

  describe("Channel Preservation During Reconnection", () => {
    it("keeps the same channel during reconnection attempts", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Error occurs
      mockES()?.onerror?.(new Event("error"))

      // Channel should still exist with same ID
      expect(adapter.channels.size).toBe(1)
      expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
    })

    it("preserves channel when reconnect() is triggered by send on closed socket", async () => {
      adapter._initialize(context)
      await adapter._start()
      mockES()?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Simulate closed socket
      const es = mockES()
      if (es) es.readyState = 2 // CLOSED

      // Trigger send, which triggers reconnect()
      const channel = Array.from(adapter.channels)[0]
      await channel.send(createSyncRequest())

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
      mockES()?.onopen?.(new Event("open"))

      const originalChannelId = Array.from(adapter.channels)[0].channelId

      // Max attempts reached - channel removed
      mockES()?.onerror?.(new Event("error"))
      mockES()?.onerror?.(new Event("error"))
      expect(adapter.channels.size).toBe(0)

      // New connection - new channel
      mockES()?.onopen?.(new Event("open"))
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
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      await channel.send(createSyncRequest())

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
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      await expect(channel.send(createSyncRequest())).rejects.toThrow(
        "Failed to fetch",
      )

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
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const sendPromise = channel.send(createSyncRequest())

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
      mockES()?.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const sendPromise = channel.send(createSyncRequest())

      // First call happens immediately
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Simulate EventSource reconnect before retry happens
      mockES()?.onopen?.(new Event("open"))

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
