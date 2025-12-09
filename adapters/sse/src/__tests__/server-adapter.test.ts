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
})
