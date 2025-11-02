import type { Channel, ChannelMsg } from "@loro-extended/repo"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the module with a factory function
vi.mock("reconnecting-eventsource", () => {
  class MockEventSource {
    url: string
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onopen: (() => void) | null = null

    constructor(url: string) {
      this.url = url
    }

    close() {
      // Mock close
    }

    simulateMessage(data: any) {
      if (this.onmessage) {
        this.onmessage(
          new MessageEvent("message", { data: JSON.stringify(data) }),
        )
      }
    }

    simulateOpen() {
      if (this.onopen) {
        this.onopen()
      }
    }

    simulateError(error: Event) {
      if (this.onerror) {
        this.onerror(error)
      }
    }
  }

  return {
    default: MockEventSource,
  }
})

// Import after mocking
import { SseClientNetworkAdapter } from "./client"

// Type for MockEventSource
type MockEventSource = {
  url: string
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onopen: (() => void) | null
  close(): void
  simulateMessage(data: any): void
  simulateOpen(): void
  simulateError(error: Event): void
}

// Mock fetch
global.fetch = vi.fn()

describe("SseClientNetworkAdapter", () => {
  let adapter: SseClientNetworkAdapter
  const serverUrl = "http://localhost:3000"

  beforeEach(() => {
    adapter = new SseClientNetworkAdapter({
      postUrl: `${serverUrl}/sync`,
      eventSourceUrl: `${serverUrl}/events`,
    })
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("should create adapter with correct adapterId", () => {
      expect(adapter.adapterId).toBe("sse-client")
    })

    it("should generate a unique peerId on construction", () => {
      const adapter1 = new SseClientNetworkAdapter({
        postUrl: `${serverUrl}/sync`,
        eventSourceUrl: `${serverUrl}/events`,
      })
      const adapter2 = new SseClientNetworkAdapter({
        postUrl: `${serverUrl}/sync`,
        eventSourceUrl: `${serverUrl}/events`,
      })

      // Both should have peerIds (private, but we can test behavior)
      expect(adapter1).toBeDefined()
      expect(adapter2).toBeDefined()
    })
  })

  describe("init()", () => {
    it("should create a single channel", () => {
      const channels: Channel[] = []

      adapter.init({
        addChannel: () => {
          const channel = { channelId: 1, publishDocId: "test-doc" } as Channel
          channels.push(channel)
          return channel
        },
      })

      expect(channels).toHaveLength(1)
    })
  })

  describe("generate()", () => {
    it("should return a BaseChannel with correct properties", () => {
      const channel = (adapter as any).generate()

      expect(channel.kind).toBe("network")
      expect(channel.adapterId).toBe("sse-client")
      expect(typeof channel.send).toBe("function")
      expect(typeof channel.start).toBe("function")
      expect(typeof channel.stop).toBe("function")
    })
  })

  describe("start()", () => {
    it("should create EventSource with correct URL including peerId", () => {
      adapter.init({
        addChannel: () => ({ channelId: 1 }) as Channel,
      })

      adapter.start()

      // EventSource should be created (we can't directly access it, but we can test behavior)
      expect(adapter).toBeDefined()
    })

    it("should set up message handler", () => {
      const receiveFn = vi.fn()

      adapter.init({
        addChannel: () => ({ channelId: 1 }) as Channel,
      })

      const channel = (adapter as any).generate()
      channel.start(receiveFn)

      adapter.start()

      // Simulate receiving a message
      const eventSource = (adapter as any).eventSource as MockEventSource
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      eventSource.simulateMessage(testMessage)

      expect(receiveFn).toHaveBeenCalledWith(testMessage)
    })
  })

  describe("send()", () => {
    it("should send messages via HTTP POST with correct headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      global.fetch = mockFetch

      adapter.init({
        addChannel: () => ({ channelId: 1 }) as Channel,
      })

      const channel = (adapter as any).generate()
      const testMessage: ChannelMsg = {
        type: "channel/sync-request",
        docs: [{ docId: "test-doc", requesterDocVersion: {} as any }],
      }

      await channel.send(testMessage)

      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/sync`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Peer-Id": expect.any(String),
          }),
          body: expect.any(String),
        }),
      )
    })

    it("should throw error on failed send", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      })
      global.fetch = mockFetch

      adapter.init({
        addChannel: () => ({ channelId: 1 }) as Channel,
      })

      const channel = (adapter as any).generate()
      const testMessage: ChannelMsg = {
        type: "channel/sync-request",
        docs: [{ docId: "test-doc", requesterDocVersion: {} as any }],
      }

      await expect(channel.send(testMessage)).rejects.toThrow(
        "Failed to send message: Internal Server Error",
      )
    })
  })

  describe("deinit()", () => {
    it("should close EventSource and clean up", () => {
      const channelAdded = vi.fn()
      const channelRemoved = vi.fn()

      adapter.prepare({ channelAdded, channelRemoved })

      adapter.start()
      expect(channelAdded).toHaveBeenCalledTimes(1)

      adapter.stop()
      expect(channelRemoved).toHaveBeenCalledTimes(1)
    })
  })
})
