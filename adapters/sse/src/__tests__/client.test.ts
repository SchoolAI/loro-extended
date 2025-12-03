/**
 * Tests for the SSE client network adapter.
 */

import type { AdapterContext, PeerID } from "@loro-extended/repo"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
      currentMockEventSource!.onopen?.(new Event("open"))

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
      expect(currentMockEventSource!.onopen).toBeDefined()
      expect(currentMockEventSource!.onmessage).toBeDefined()
      expect(currentMockEventSource!.onerror).toBeDefined()
    })

    it("creates channel on EventSource open", async () => {
      adapter._initialize(context)
      await adapter._start()

      expect(adapter.channels.size).toBe(0)

      // Simulate EventSource open
      currentMockEventSource!.onopen?.(new Event("open"))

      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)
    })

    it("removes channel on EventSource error", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel first
      currentMockEventSource!.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)

      // Simulate error
      currentMockEventSource!.onerror?.(new Event("error"))

      expect(adapter.channels.size).toBe(0)
      expect(context.onChannelRemoved).toHaveBeenCalledTimes(1)
    })

    it("closes EventSource on stop", async () => {
      adapter._initialize(context)
      await adapter._start()

      currentMockEventSource!.onopen?.(new Event("open"))

      await adapter._stop()

      expect(currentMockEventSource!.close).toHaveBeenCalled()
      expect(adapter.channels.size).toBe(0)
    })
  })

  describe("Reconnection Logic", () => {
    it("triggers reconnection when EventSource is closed before send", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource!.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Store reference to the old EventSource before it gets replaced
      const oldEventSource = currentMockEventSource!

      // Simulate EventSource being closed
      currentMockEventSource!.readyState = 2 // CLOSED

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
      currentMockEventSource!.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // Simulate EventSource being closed
      currentMockEventSource!.readyState = 2 // CLOSED

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
      currentMockEventSource!.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      // EventSource is open (readyState = 1)
      currentMockEventSource!.readyState = 1

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

    it("removes old channel before creating new one on reconnection", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create initial channel
      currentMockEventSource!.onopen?.(new Event("open"))
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(1)

      // Simulate reconnection by triggering onopen again
      currentMockEventSource!.onopen?.(new Event("open"))

      // Should have removed old channel and added new one
      expect(adapter.channels.size).toBe(1)
      expect(context.onChannelRemoved).toHaveBeenCalledTimes(1)
      expect(context.onChannelAdded).toHaveBeenCalledTimes(2)
    })
  })

  describe("Message Handling", () => {
    it("receives messages from EventSource", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Create channel
      currentMockEventSource!.onopen?.(new Event("open"))

      // Simulate receiving a message
      const messageData = {
        type: "channel/establish-response",
        identity: { peerId: "server-peer", name: "Server", type: "service" },
      }

      currentMockEventSource!.onmessage?.({
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

      currentMockEventSource!.onmessage?.({
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

      currentMockEventSource!.onopen?.(new Event("open"))
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

      currentMockEventSource!.onopen?.(new Event("open"))
      const channel = Array.from(adapter.channels)[0]

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      await expect(channel.send(message)).rejects.toThrow(
        "Failed to send message: Internal Server Error",
      )
    })
  })
})
