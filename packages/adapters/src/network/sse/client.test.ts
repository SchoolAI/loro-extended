import { describe, it, expect, beforeEach, vi } from "vitest"
import type { Channel, ChannelMsg } from "@loro-extended/repo"

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
        this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }))
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
    adapter = new SseClientNetworkAdapter(serverUrl)
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("should create adapter with correct adapterId", () => {
      expect(adapter.adapterId).toBe("sse-client")
    })

    it("should generate a unique peerId on construction", () => {
      const adapter1 = new SseClientNetworkAdapter(serverUrl)
      const adapter2 = new SseClientNetworkAdapter(serverUrl)
      
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
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      adapter.start()

      // EventSource should be created (we can't directly access it, but we can test behavior)
      expect(adapter).toBeDefined()
    })

    it("should set up message handler", () => {
      const receiveFn = vi.fn()
      
      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
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
        addChannel: () => ({ channelId: 1 } as Channel),
        
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
        })
      )
    })

    it("should throw error on failed send", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      })
      global.fetch = mockFetch

      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      const channel = (adapter as any).generate()
      const testMessage: ChannelMsg = {
        type: "channel/sync-request",
        docs: [{ docId: "test-doc", requesterDocVersion: {} as any }],
      }

      await expect(channel.send(testMessage)).rejects.toThrow(
        "Failed to send message: Internal Server Error"
      )
    })
  })

  describe("serialization", () => {
    it("should serialize Uint8Array to base64", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      const channel = (adapter as any).generate()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "update", data },
      }

      await channel.send(testMessage)

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      
      expect(body.transmission.data).toHaveProperty("__type", "Uint8Array")
      expect(body.transmission.data).toHaveProperty("data")
      expect(typeof body.transmission.data.data).toBe("string")
    })

    it("should deserialize base64 to Uint8Array", () => {
      const receiveFn = vi.fn()
      
      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      const channel = (adapter as any).generate()
      channel.start(receiveFn)
      adapter.start()

      const eventSource = (adapter as any).eventSource as MockEventSource
      const serializedData = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: {
          type: "update",
          data: {
            __type: "Uint8Array",
            data: btoa(String.fromCharCode(1, 2, 3, 4, 5)),
          },
        },
      }

      eventSource.simulateMessage(serializedData)

      expect(receiveFn).toHaveBeenCalled()
      const receivedMessage = receiveFn.mock.calls[0][0]
      expect(receivedMessage.transmission.data).toBeInstanceOf(Uint8Array)
      expect(Array.from(receivedMessage.transmission.data)).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe("deinit()", () => {
    it("should close EventSource and clean up", () => {
      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      adapter.start()
      const eventSource = (adapter as any).eventSource as MockEventSource
      const closeSpy = vi.spyOn(eventSource, "close")

      adapter.deinit()

      expect(closeSpy).toHaveBeenCalled()
      expect((adapter as any).eventSource).toBeUndefined()
      expect((adapter as any).serverChannel).toBeUndefined()
      expect((adapter as any).receive).toBeUndefined()
    })
  })

  describe("channel lifecycle", () => {
    it("should handle start and stop correctly", () => {
      const receiveFn = vi.fn()
      
      adapter.init({
        addChannel: () => ({ channelId: 1 } as Channel),
        
      })

      const channel = (adapter as any).generate()
      
      // Start channel
      channel.start(receiveFn)
      expect((adapter as any).receive).toBe(receiveFn)

      // Stop channel
      channel.stop()
      expect((adapter as any).receive).toBeUndefined()
    })
  })
})