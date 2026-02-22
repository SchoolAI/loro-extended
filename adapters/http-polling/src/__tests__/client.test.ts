import type {
  AdapterContext,
  ChannelMsgSyncRequest,
  PeerID,
} from "@loro-extended/repo"
import { VersionVector } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_FRAGMENT_THRESHOLD,
  HttpPollingClientNetworkAdapter,
} from "../client.js"

// Helper to create a valid sync-request message
function createSyncRequest(): ChannelMsgSyncRequest {
  return {
    type: "channel/sync-request",
    docId: "test-doc",
    requesterDocVersion: new VersionVector(null),
    bidirectional: false,
  }
}

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

  describe("Binary CBOR Encoding", () => {
    it("sends messages with Content-Type: application/octet-stream", async () => {
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

      // 2. Setup success for the POST request
      mockFetch.mockResolvedValueOnce({ ok: true })

      const message = createSyncRequest()
      await channel.send(message)

      // Find the POST call (not the GET poll call)
      const postCall = mockFetch.mock.calls.find(
        call => call[1]?.method === "POST",
      )
      expect(postCall).toBeDefined()
      const postCallOptions = postCall?.[1]
      expect(postCallOptions?.headers["Content-Type"]).toBe(
        "application/octet-stream",
      )
    })

    it("sends binary data as Blob", async () => {
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

      // 2. Setup success for the POST request
      mockFetch.mockResolvedValueOnce({ ok: true })

      const message = createSyncRequest()
      await channel.send(message)

      // Find the POST call
      const postCall = mockFetch.mock.calls.find(
        call => call[1]?.method === "POST",
      )
      expect(postCall).toBeDefined()
      const postCallOptions = postCall?.[1]
      expect(postCallOptions?.body).toBeInstanceOf(Blob)
    })

    it("includes X-Peer-Id header in POST requests", async () => {
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

      // 2. Setup success for the POST request
      mockFetch.mockResolvedValueOnce({ ok: true })

      const message = createSyncRequest()
      await channel.send(message)

      // Find the POST call
      const postCall = mockFetch.mock.calls.find(
        call => call[1]?.method === "POST",
      )
      expect(postCall).toBeDefined()
      const postCallOptions = postCall?.[1]
      expect(postCallOptions?.headers["X-Peer-Id"]).toBe("123456789")
    })
  })

  describe("Fragment Threshold Configuration", () => {
    it("has default fragment threshold of 80KB", () => {
      expect(DEFAULT_FRAGMENT_THRESHOLD).toBe(80 * 1024)
    })

    it("accepts custom fragment threshold", () => {
      const customAdapter = new HttpPollingClientNetworkAdapter({
        pollUrl: "/api/poll",
        postUrl: "/api/sync",
        fragmentThreshold: 50 * 1024,
      })

      // We can't directly access the private field, but we can verify the adapter accepts the option
      expect(customAdapter).toBeDefined()
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

      const message = createSyncRequest()

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

      const message = createSyncRequest()

      // Should throw after max attempts
      await expect(channel.send(message)).rejects.toThrow("Failed to fetch")
    })

    it("does not retry on 4xx client errors", async () => {
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

      // 2. Setup 400 error for the POST request
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      })

      const message = createSyncRequest()

      // Should fail immediately without retry
      await expect(channel.send(message)).rejects.toThrow(
        "Failed to send message: Bad Request",
      )
    })
  })

  describe("URL Resolution", () => {
    it("supports function-based URL resolution", async () => {
      const urlFn = vi.fn((peerId: PeerID) => `/api/sync/${peerId}`)

      adapter = new HttpPollingClientNetworkAdapter({
        pollUrl: "/api/poll",
        postUrl: urlFn,
        minPollInterval: 10,
        pollDelay: 10,
      })

      // 1. Setup successful poll response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], isNewConnection: true }),
      })

      adapter._initialize(context)
      await adapter._start()

      // Wait for poll loop to process
      await new Promise(resolve => setTimeout(resolve, 50))

      const channel = Array.from(adapter.channels)[0]
      expect(channel).toBeDefined()

      // 2. Setup success for POST
      mockFetch.mockResolvedValueOnce({ ok: true })

      const message = createSyncRequest()
      await channel.send(message)

      expect(urlFn).toHaveBeenCalledWith("123456789")
    })
  })
})
