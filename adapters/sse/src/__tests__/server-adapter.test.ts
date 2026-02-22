import type { PeerID } from "@loro-extended/repo"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SseServerNetworkAdapter } from "../server-adapter"

// Mock logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  getChild: vi.fn().mockReturnThis(),
  with: vi.fn().mockReturnThis(),
}

describe("SseServerNetworkAdapter", () => {
  let adapter: SseServerNetworkAdapter
  const peerId = "test-peer" as PeerID

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new SseServerNetworkAdapter()
    // Inject mock logger
    ;(adapter as any).logger = mockLogger

    // Initialize adapter to set up channels directory
    adapter._initialize({
      identity: { peerId: "server" as PeerID, name: "Server", type: "service" },
      logger: mockLogger as any,
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    })

    // Start the adapter
    adapter._start()
  })

  describe("Connection Management", () => {
    it("cleans up existing connection when same peer reconnects", () => {
      // First connection
      const conn1 = adapter.registerConnection(peerId)
      const channelId1 = conn1.channelId

      // Verify first connection active
      expect(adapter.channels.has(channelId1)).toBe(true)
      expect(adapter.getConnection(peerId)).toBe(conn1)

      // Second connection (reconnect)
      const conn2 = adapter.registerConnection(peerId)
      const channelId2 = conn2.channelId

      // Verify old channel removed
      expect(adapter.channels.has(channelId1)).toBe(false)

      // Verify new channel active
      expect(adapter.channels.has(channelId2)).toBe(true)
      expect(adapter.getConnection(peerId)).toBe(conn2)
      expect(conn1).not.toBe(conn2)
    })

    it("logs when cleaning up existing connection on reconnect", () => {
      // First connection
      adapter.registerConnection(peerId)

      // Clear previous logs
      mockLogger.info.mockClear()

      // Second connection (reconnect)
      adapter.registerConnection(peerId)

      // Verify log message
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Cleaning up existing connection for peer"),
        expect.objectContaining({ peerId }),
      )
    })
  })

  describe("Reassembler Lifecycle", () => {
    it("creates reassembler for each connection", () => {
      const conn = adapter.registerConnection(peerId)

      expect(conn.reassembler).toBeDefined()
      expect(conn.reassembler.pendingBatchCount).toBe(0)
    })

    it("disposes reassembler when connection is unregistered", () => {
      const conn = adapter.registerConnection(peerId)
      const reassembler = conn.reassembler

      // Spy on dispose
      const disposeSpy = vi.spyOn(reassembler, "dispose")

      adapter.unregisterConnection(peerId)

      expect(disposeSpy).toHaveBeenCalled()
    })

    it("disposes old reassembler when peer reconnects", () => {
      const conn1 = adapter.registerConnection(peerId)
      const reassembler1 = conn1.reassembler
      const disposeSpy = vi.spyOn(reassembler1, "dispose")

      // Reconnect same peer
      const conn2 = adapter.registerConnection(peerId)

      // Old reassembler should be disposed
      expect(disposeSpy).toHaveBeenCalled()

      // New connection has fresh reassembler
      expect(conn2.reassembler).not.toBe(reassembler1)
    })

    it("each connection has independent reassembler", () => {
      const peer1 = "peer-1" as PeerID
      const peer2 = "peer-2" as PeerID

      const conn1 = adapter.registerConnection(peer1)
      const conn2 = adapter.registerConnection(peer2)

      expect(conn1.reassembler).not.toBe(conn2.reassembler)
    })
  })
})
