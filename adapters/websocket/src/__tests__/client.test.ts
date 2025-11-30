import { LoroDoc } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WsClientNetworkAdapter } from "../client.js"
import { MESSAGE_TYPE } from "../protocol/constants.js"
import { decodeMessage, encodeMessage } from "../protocol/index.js"

// Mock WebSocket implementation
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static syncConnection = false

  public url: string
  public binaryType = "blob"
  public readyState = 0 // CONNECTING

  private listeners: Record<string, ((event: any) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)

    if (MockWebSocket.syncConnection) {
      this.readyState = 1 // OPEN
      // We need to defer the event slightly to allow listeners to be attached
      Promise.resolve().then(() => {
        this.dispatchEvent("open", {})
      })
    } else {
      // Simulate connection delay
      setTimeout(() => {
        this.readyState = 1 // OPEN
        this.dispatchEvent("open", {})
      }, 0)
    }
  }

  send(_data: any) {
    // Mock send
  }

  close(code = 1000, reason = "") {
    this.readyState = 3 // CLOSED
    this.dispatchEvent("close", { code, reason })
  }

  addEventListener(event: string, handler: (event: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(handler)
  }

  removeEventListener(event: string, handler: (event: any) => void) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter(h => h !== handler)
  }

  dispatchEvent(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(handler => {
        handler(data)
      })
    }
  }

  // Helper to simulate incoming message
  simulateMessage(data: any) {
    this.dispatchEvent("message", { data })
  }
}

describe("WsClientNetworkAdapter", () => {
  let adapter: WsClientNetworkAdapter

  beforeEach(() => {
    MockWebSocket.instances = []
    adapter = new WsClientNetworkAdapter({
      url: "ws://localhost:3000",
      WebSocket: MockWebSocket as any,
      reconnect: { enabled: false }, // Disable reconnect for most tests
    })

    adapter._initialize({
      identity: { peerId: "client-1" as any, name: "client", type: "user" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
  })

  afterEach(async () => {
    await adapter.onStop()
  })

  it("should connect on start", async () => {
    await adapter._start()

    expect(MockWebSocket.instances.length).toBe(1)
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:3000")
    expect(adapter.isConnected).toBe(true)
  })

  it("should resolve url function with peerId", async () => {
    const urlFn = vi.fn().mockReturnValue("ws://localhost:3000/custom")
    adapter = new WsClientNetworkAdapter({
      url: urlFn,
      WebSocket: MockWebSocket as any,
      reconnect: { enabled: false },
    })

    adapter._initialize({
      identity: { peerId: "client-1" as any, name: "client", type: "user" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })

    await adapter._start()

    expect(urlFn).toHaveBeenCalledWith("client-1")
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:3000/custom")
  })

  it("should send messages when connected", async () => {
    await adapter._start()
    const socket = MockWebSocket.instances[0]
    const sendSpy = vi.spyOn(socket, "send")

    const msg = {
      type: "channel/sync-request" as const,
      docs: [
        {
          docId: "doc-1",
          requesterDocVersion: new LoroDoc().version(),
        },
      ],
      bidirectional: true,
    }

    // We need to access the channel to send, but client adapter has a single channel
    // exposed via generate(). However, generate() returns a GeneratedChannel which
    // delegates to the internal socket.
    // The adapter's `send` method (from generate) is what we want to test.
    // But `Adapter.channels` manages channels.
    // The client adapter creates a channel in `connect()`.

    // Let's simulate the synchronizer sending a message via the adapter
    // We can use the `send` method from the generated channel, but we need to get it.
    // The adapter doesn't expose the generated channel directly easily for testing
    // without going through the channel directory.

    // Let's use the internal `serverChannel` if we can, or just use `adapter.channels.get(channelId).send(msg)`
    // We need to know the channelId.

    // Wait, `WsClientNetworkAdapter` is an `Adapter<void>`.
    // `generate()` returns a channel that sends to the socket.
    // The adapter creates a channel in `connect()`: `this.serverChannel = this.addChannel()`.

    // We can't easily get the channel ID from outside without inspecting internals or mocking `addChannel`.
    // But we can spy on `socket.send`.

    // Let's assume the adapter has created a channel.
    // We can iterate over channels to find it.
    // But `adapter.channels` is protected.

    // Actually, `WsClientNetworkAdapter` is designed to have one server channel.
    // Let's use `any` to access private property for testing or mock `addChannel`.

    const serverChannel = (adapter as any).serverChannel
    expect(serverChannel).toBeDefined()

    serverChannel.send(msg)

    expect(sendSpy).toHaveBeenCalled()
    const sentData = sendSpy.mock.calls[0][0] as Uint8Array
    expect(sentData).toBeInstanceOf(Uint8Array)

    // Verify it's a JoinRequest (since it's a sync-request)
    const decoded = decodeMessage(sentData)
    expect(decoded.type).toBe(MESSAGE_TYPE.JoinRequest)
  })

  it("should handle incoming protocol messages", async () => {
    // Create new adapter to avoid re-initialization
    const testAdapter = new WsClientNetworkAdapter({
      url: "ws://localhost:3000",
      WebSocket: MockWebSocket as any,
      reconnect: { enabled: false },
    })

    const onChannelReceive = vi.fn()
    testAdapter._initialize({
      identity: { peerId: "client-1" as any, name: "client", type: "user" },
      onChannelReceive,
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })

    await testAdapter._start()
    const socket = MockWebSocket.instances[0]

    // Simulate incoming JoinResponseOk
    const joinResponse = {
      type: MESSAGE_TYPE.JoinResponseOk,
      crdtType: "loro" as const,
      roomId: "doc-1",
      permission: "write" as const,
      receiverVersion: new LoroDoc().version().encode(),
      metadata: new Uint8Array(0),
    }

    const encoded = encodeMessage(joinResponse)
    // The adapter expects ArrayBuffer because binaryType is set to 'arraybuffer'
    socket.simulateMessage(encoded.buffer)

    expect(onChannelReceive).toHaveBeenCalled()
    // We expect establish-response first due to simulateHandshake
    const calls = onChannelReceive.mock.calls
    const syncResponse = calls.find(
      (c: any[]) => c[1].type === "channel/sync-response",
    )
    expect(syncResponse).toBeDefined()
  })

  it("should reconnect on close if enabled", async () => {
    vi.useFakeTimers()
    // Use sync connection to work with fake timers
    MockWebSocket.syncConnection = true

    adapter = new WsClientNetworkAdapter({
      url: "ws://localhost:3000",
      WebSocket: MockWebSocket as any,
      reconnect: {
        enabled: true,
        baseDelay: 100,
        maxDelay: 1000,
      },
    })

    adapter._initialize({
      identity: { peerId: "client-1" as any, name: "client", type: "user" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })

    // Start connection
    const startPromise = adapter._start()

    // Resolve the connection promise (MockWebSocket uses Promise.resolve().then)
    await Promise.resolve()
    await Promise.resolve()
    await startPromise

    expect(MockWebSocket.instances.length).toBe(1)

    // Close the socket
    MockWebSocket.instances[0].close()

    // Fast forward time to trigger reconnect
    await vi.advanceTimersByTimeAsync(1200) // baseDelay + jitter

    // Should have created a new socket
    expect(MockWebSocket.instances.length).toBe(2)

    vi.useRealTimers()
    MockWebSocket.syncConnection = false
  })

  it("should send ping for keepalive", async () => {
    vi.useFakeTimers()
    MockWebSocket.syncConnection = true

    adapter = new WsClientNetworkAdapter({
      url: "ws://localhost:3000",
      WebSocket: MockWebSocket as any,
      keepaliveInterval: 1000,
      reconnect: { enabled: false },
    })

    adapter._initialize({
      identity: { peerId: "client-1" as any, name: "client", type: "user" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })

    const startPromise = adapter._start()
    await Promise.resolve()
    await Promise.resolve()
    await startPromise

    const socket = MockWebSocket.instances[0]
    const sendSpy = vi.spyOn(socket, "send")

    await vi.advanceTimersByTimeAsync(1100)

    expect(sendSpy).toHaveBeenCalledWith("ping")

    vi.useRealTimers()
    MockWebSocket.syncConnection = false
  })
})
