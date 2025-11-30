import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WsServerNetworkAdapter } from "../server-adapter.js"
import type { WsSocket, WsReadyState } from "../handler/types.js"
import type { PeerID } from "@loro-extended/repo"
import { decodeMessage, encodeMessage } from "../protocol/index.js"
import { MESSAGE_TYPE } from "../protocol/constants.js"
import { LoroDoc } from "loro-crdt"

class MockWsSocket implements WsSocket {
  public sentMessages: (Uint8Array | string)[] = []
  public readyState: WsReadyState = "open"
  
  private messageHandler?: (data: Uint8Array | string) => void
  private closeHandler?: (code: number, reason: string) => void
  private errorHandler?: (error: Error) => void

  send(data: Uint8Array | string) {
    this.sentMessages.push(data)
  }

  close(code = 1000, reason = "") {
    this.readyState = "closed"
    this.closeHandler?.(code, reason)
  }

  onMessage(handler: (data: Uint8Array | string) => void) {
    this.messageHandler = handler
  }

  onClose(handler: (code: number, reason: string) => void) {
    this.closeHandler = handler
  }

  onError(handler: (error: Error) => void) {
    this.errorHandler = handler
  }

  // Helper to simulate incoming message
  simulateMessage(data: Uint8Array | string) {
    this.messageHandler?.(data)
  }

  // Helper to simulate error
  simulateError(error: Error) {
    this.errorHandler?.(error)
  }
}

describe("WsServerNetworkAdapter", () => {
  let adapter: WsServerNetworkAdapter
  let mockSocket: MockWsSocket

  beforeEach(() => {
    adapter = new WsServerNetworkAdapter()
    mockSocket = new MockWsSocket()
    
    // Initialize adapter with mock hooks
    adapter._initialize({
      identity: { peerId: "server-1" as PeerID, name: "server", type: "service" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
  })

  afterEach(async () => {
    await adapter.onStop()
  })

  it("should handle new connection", async () => {
    await adapter._start()
    
    const { connection, start } = adapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()

    expect(adapter.isConnected("client-1" as PeerID)).toBe(true)
    expect(connection.peerId).toBe("client-1")
  })

  it("should generate peerId if not provided", async () => {
    await adapter._start()
    
    const { connection, start } = adapter.handleConnection({
      socket: mockSocket,
    })
    start()

    expect(connection.peerId).toBeDefined()
    expect(connection.peerId.startsWith("ws-")).toBe(true)
    expect(adapter.isConnected(connection.peerId)).toBe(true)
  })

  it("should unregister connection on socket close", async () => {
    await adapter._start()
    
    const { start } = adapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()

    mockSocket.close()

    expect(adapter.isConnected("client-1" as PeerID)).toBe(false)
  })

  it("should unregister connection on socket error", async () => {
    await adapter._start()
    
    const { start } = adapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()

    mockSocket.simulateError(new Error("Socket error"))

    expect(adapter.isConnected("client-1" as PeerID)).toBe(false)
  })

  it("should replace existing connection for same peerId", async () => {
    await adapter._start()
    
    const socket1 = new MockWsSocket()
    const socket2 = new MockWsSocket()

    // First connection
    const { start: start1 } = adapter.handleConnection({
      socket: socket1,
      peerId: "client-1" as PeerID,
    })
    start1()

    expect(adapter.isConnected("client-1" as PeerID)).toBe(true)
    expect(socket1.readyState).toBe("open")

    // Second connection with same peerId
    const { start: start2 } = adapter.handleConnection({
      socket: socket2,
      peerId: "client-1" as PeerID,
    })
    start2()

    expect(adapter.isConnected("client-1" as PeerID)).toBe(true)
    expect(socket1.readyState).toBe("closed") // Should be closed
    expect(socket2.readyState).toBe("open")
  })

  it("should send messages to connected peer", async () => {
    await adapter._start()
    
    const { start } = adapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()

    // Simulate sending a message through the adapter
    // We need to access the channel to send
    const connection = adapter.getConnection("client-1" as PeerID)
    expect(connection).toBeDefined()

    // Send a sync request with at least one doc so it generates protocol messages
    const msg = {
      type: "channel/sync-request" as const,
      docs: [
        {
          docId: "doc-1",
          requesterDocVersion: new LoroDoc().version(),
        }
      ],
      bidirectional: true,
    }
    
    connection!.send(msg)

    // Should have sent protocol messages
    expect(mockSocket.sentMessages.length).toBeGreaterThan(0)
  })

  it("should handle incoming protocol messages", async () => {
    // Create a new adapter to avoid re-initialization error
    const testAdapter = new WsServerNetworkAdapter()
    const onChannelReceive = vi.fn()
    
    testAdapter._initialize({
      identity: { peerId: "server-1" as PeerID, name: "server", type: "service" },
      onChannelReceive,
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
    await testAdapter._start()
    
    const { start } = testAdapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()
    
    // Create a JoinRequest message
    const joinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro" as const,
      roomId: "doc-1",
      authPayload: new Uint8Array(0),
      requesterVersion: new LoroDoc().version().encode(),
    }
    
    const encoded = encodeMessage(joinRequest)
    mockSocket.simulateMessage(encoded)

    // Should have triggered onChannelReceive with translated message
    expect(onChannelReceive).toHaveBeenCalled()
    const call = onChannelReceive.mock.calls[0]
    expect(call[1].type).toBe("channel/sync-request")
  })

  it("should handle keepalive ping", async () => {
    await adapter._start()
    
    const { start } = adapter.handleConnection({
      socket: mockSocket,
      peerId: "client-1" as PeerID,
    })
    start()

    mockSocket.simulateMessage("ping")

    expect(mockSocket.sentMessages).toContain("pong")
  })

  it("should close all connections on stop", async () => {
    await adapter._start()
    
    const socket1 = new MockWsSocket()
    const socket2 = new MockWsSocket()

    const { start: start1 } = adapter.handleConnection({
      socket: socket1,
      peerId: "client-1" as PeerID,
    })
    start1()

    const { start: start2 } = adapter.handleConnection({
      socket: socket2,
      peerId: "client-2" as PeerID,
    })
    start2()

    expect(adapter.connectionCount).toBe(2)

    await adapter.onStop()

    expect(socket1.readyState).toBe("closed")
    expect(socket2.readyState).toBe("closed")
    expect(adapter.connectionCount).toBe(0)
  })
})