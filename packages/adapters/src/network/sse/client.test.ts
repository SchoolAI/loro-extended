import type { AdapterHooks, Channel, ChannelMsg } from "@loro-extended/repo"
import { VersionVector } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SseClientNetworkAdapter } from "./client"

// Mock the module with a factory function
const mockEventSourceInstance = {
  close: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onopen: null as (() => void) | null,
  onerror: null as ((error: Event) => void) | null,
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent("message", { data: JSON.stringify(data) }),
      )
    }
  },
  simulateOpen() {
    if (this.onopen) {
      this.onopen()
    }
  },
  simulateError(error: Event) {
    if (this.onerror) {
      this.onerror(error)
    }
  },
}

vi.mock("reconnecting-eventsource", () => {
  const MockEventSource = vi.fn(() => mockEventSourceInstance)
  return {
    default: MockEventSource,
  }
})

// Mock fetch
global.fetch = vi.fn()

describe("SseClientNetworkAdapter", () => {
  let adapter: SseClientNetworkAdapter
  let hooks: AdapterHooks
  const serverUrl = "http://localhost:3000"

  beforeEach(() => {
    adapter = new SseClientNetworkAdapter({
      postUrl: `${serverUrl}/sync`,
      eventSourceUrl: `${serverUrl}/events`,
    })

    const channels: Record<number, Channel> = {}
    hooks = {
      identity: { peerId: "123", name: "test-client", type: "user" },
      onChannelAdded: vi.fn((channel: Channel) => {
        channels[channel.channelId] = channel
      }),
      onChannelRemoved: vi.fn((channel: Channel) => {
        delete channels[channel.channelId]
      }),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    }

    adapter._initialize(hooks)
    vi.clearAllMocks()
    mockEventSourceInstance.close.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("should create adapter with correct adapterId", () => {
      expect(adapter.adapterId).toBe("sse-client")
    })
  })

  describe("generate()", () => {
    it("should return a GeneratedChannel with correct properties", () => {
      const channel = (adapter as any).generate()
      expect(channel.kind).toBe("network")
      expect(channel.adapterId).toBe("sse-client")
      expect(typeof channel.send).toBe("function")
      expect(typeof channel.stop).toBe("function")
    })
  })

  describe("onStart()", () => {
    it("should add a channel and create an EventSource", async () => {
      await adapter._start()
      mockEventSourceInstance.simulateOpen()
      expect(hooks.onChannelAdded).toHaveBeenCalledTimes(1)
      const MockEventSource = (await import("reconnecting-eventsource")).default
      expect(MockEventSource).toHaveBeenCalledTimes(1)
    })

    it("should set up message handler on the EventSource", async () => {
      await adapter._start()
      mockEventSourceInstance.simulateOpen()
      const serverChannel = (hooks.onChannelAdded as any).mock.calls[0][0]

      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        transmission: {
          type: "up-to-date",
          version: new VersionVector(new Map()),
        },
      }

      mockEventSourceInstance.simulateMessage(testMessage)
      expect(hooks.onChannelReceive).toHaveBeenCalledWith(
        serverChannel,
        expect.objectContaining({
          type: "channel/sync-response",
          docId: "test-doc",
          transmission: expect.objectContaining({
            type: "up-to-date",
          }),
        }),
      )
    })

    it("should establish channel on EventSource open", async () => {
      await adapter._start()
      mockEventSourceInstance.simulateOpen()
      expect(hooks.onChannelEstablish).toHaveBeenCalledTimes(1)
    })
  })

  describe("onStop()", () => {
    it("should close EventSource and remove channel", async () => {
      await adapter._start()
      mockEventSourceInstance.simulateOpen()
      const serverChannel = (hooks.onChannelAdded as any).mock.calls[0][0]

      await adapter._stop()

      expect(mockEventSourceInstance.close).toHaveBeenCalledTimes(1)
      expect(hooks.onChannelRemoved).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: serverChannel.channelId }),
      )
    })
  })

  describe("send()", () => {
    it("should send messages via HTTP POST with correct headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      global.fetch = mockFetch

      await adapter._start()
      const channel = (adapter as any).generate()

      const testMessage: ChannelMsg = {
        type: "channel/sync-request",
        docs: [
          {
            docId: "test-doc",
            requesterDocVersion: new VersionVector(new Map()),
          },
        ],
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
          body: expect.any(String), // Serialized JSON
        }),
      )
    })
  })
})
