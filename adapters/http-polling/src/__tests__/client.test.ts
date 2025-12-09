import type { AdapterContext, PeerID } from "@loro-extended/repo"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HttpPollingClientNetworkAdapter } from "../client.js"

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock logger
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

describe("HttpPollingClientNetworkAdapter", () => {
  let adapter: HttpPollingClientNetworkAdapter
  let context: AdapterContext

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], isNewConnection: true }),
    })

    adapter = new HttpPollingClientNetworkAdapter({
      pollUrl: "/api/poll",
      postUrl: "/api/sync",
      minPollInterval: 10,
      pollDelay: 10,
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

  describe("Connection State Tracking", () => {
    it("starts in 'disconnected' state", () => {
      expect(adapter.connectionState).toBe("disconnected")
    })

    it("transitions to 'connecting' on start", async () => {
      adapter._initialize(context)
      const startPromise = adapter._start()

      expect(adapter.connectionState).toBe("connecting")

      await startPromise
    })

    it("transitions to 'connected' on successful poll", async () => {
      adapter._initialize(context)
      await adapter._start()

      // Wait for poll loop to run
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(adapter.connectionState).toBe("connected")
    })

    it("transitions to 'reconnecting' on poll error", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))

      adapter._initialize(context)
      await adapter._start()

      // Wait for poll loop to run and fail
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(adapter.connectionState).toBe("reconnecting")
    })
  })

  describe("POST Retry Logic", () => {
    it("retries on network error", async () => {
      // 1. Setup successful poll response for connection establishment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], isNewConnection: true }),
      })

      adapter._initialize(context)
      await adapter._start()

      // Wait for poll loop to process the response and create channel
      await new Promise(resolve => setTimeout(resolve, 50))

      const channel = Array.from(adapter.channels)[0]
      expect(channel).toBeDefined()

      // 2. Setup failure then success for the POST request
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      mockFetch.mockResolvedValueOnce({ ok: true })

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      // Should succeed after retry
      await channel.send(message)

      // mockFetch called: 1 (poll) + 1 (fail post) + 1 (success post) = 3
      // But poll loop continues, so it might be more.
      // We can check that it was called at least 3 times.
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    it("fails after max attempts", async () => {
      // 1. Setup successful poll response for connection establishment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], isNewConnection: true }),
      })

      adapter = new HttpPollingClientNetworkAdapter({
        pollUrl: "/api/poll",
        postUrl: "/api/sync",
        minPollInterval: 10,
        pollDelay: 10,
        postRetry: { maxAttempts: 2, baseDelay: 10 },
      })

      adapter._initialize(context)
      await adapter._start()

      // Wait for poll loop to process the response and create channel
      await new Promise(resolve => setTimeout(resolve, 50))

      const channel = Array.from(adapter.channels)[0]
      expect(channel).toBeDefined()

      // 2. Setup failures for the POST request
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))

      const message = {
        type: "channel/sync-request" as const,
        docs: [],
        bidirectional: false,
      }

      // Should throw after max attempts
      await expect(channel.send(message)).rejects.toThrow("Failed to fetch")
    })
  })
})
