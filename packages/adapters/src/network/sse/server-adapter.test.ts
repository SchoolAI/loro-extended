import type { AdapterHooks, ChannelMsg, PeerID } from "@loro-extended/repo"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SseConnection, SseServerNetworkAdapter } from "./server-adapter"

describe("SseServerNetworkAdapter", () => {
  let adapter: SseServerNetworkAdapter
  let hooks: AdapterHooks

  beforeEach(() => {
    adapter = new SseServerNetworkAdapter()

    hooks = {
      identity: { peerId: "123", name: "test-server" },
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelReceive: vi.fn(),
      onChannelEstablish: vi.fn(),
    }

    adapter._initialize(hooks)
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("should create adapter with correct adapterId", () => {
      expect(adapter.adapterId).toBe("sse-server")
    })
  })

  describe("lifecycle", () => {
    it("should start successfully", async () => {
      const loggerSpy = vi.spyOn(adapter.logger, "info")
      await adapter._start()
      expect(loggerSpy).toHaveBeenCalledWith("SSE server adapter started")
    })

    it("should stop and disconnect all connections", async () => {
      await adapter._start()

      // Register some connections
      const conn1 = adapter.registerConnection("1" as PeerID)
      const conn2 = adapter.registerConnection("2" as PeerID)

      const disconnectSpy1 = vi.fn()
      const disconnectSpy2 = vi.fn()
      conn1.setDisconnectHandler(disconnectSpy1)
      conn2.setDisconnectHandler(disconnectSpy2)

      await adapter._stop()

      expect(disconnectSpy1).toHaveBeenCalled()
      expect(disconnectSpy2).toHaveBeenCalled()
      expect(adapter.getAllConnections()).toHaveLength(0)
    })
  })

  describe("connection management", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should register a new connection", () => {
      const peerId: PeerID = "123"
      const connection = adapter.registerConnection(peerId)

      expect(connection).toBeInstanceOf(SseConnection)
      expect(connection.peerId).toBe(peerId)
      expect(adapter.isConnected(peerId)).toBe(true)
      expect(hooks.onChannelAdded).toHaveBeenCalledTimes(1)
    })

    it("should unregister a connection", () => {
      const peerId: PeerID = "456"
      adapter.registerConnection(peerId)

      adapter.unregisterConnection(peerId)

      expect(adapter.isConnected(peerId)).toBe(false)
      expect(adapter.getConnection(peerId)).toBeUndefined()
      expect(hooks.onChannelRemoved).toHaveBeenCalledTimes(1)
    })

    it("should get a connection by peerId", () => {
      const peerId: PeerID = "789"
      const connection = adapter.registerConnection(peerId)

      const retrieved = adapter.getConnection(peerId)
      expect(retrieved).toBe(connection)
    })

    it("should get all connections", () => {
      adapter.registerConnection("100" as PeerID)
      adapter.registerConnection("200" as PeerID)
      adapter.registerConnection("300" as PeerID)

      const connections = adapter.getAllConnections()
      expect(connections).toHaveLength(3)
    })

    it("should check if peer is connected", () => {
      const peerId: PeerID = "999"

      expect(adapter.isConnected(peerId)).toBe(false)

      adapter.registerConnection(peerId)
      expect(adapter.isConnected(peerId)).toBe(true)

      adapter.unregisterConnection(peerId)
      expect(adapter.isConnected(peerId)).toBe(false)
    })
  })

  describe("message handling", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should send messages through connection", () => {
      const peerId: PeerID = "111"
      const connection = adapter.registerConnection(peerId)

      const sendFn = vi.fn()
      connection.setSendFunction(sendFn)

      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      connection.send(testMessage)
      expect(sendFn).toHaveBeenCalledWith(testMessage)
    })

    it("should receive messages through connection", () => {
      const peerId: PeerID = "222"
      const connection = adapter.registerConnection(peerId)

      const testMessage: ChannelMsg = {
        type: "channel/sync-request",
        docs: [{ docId: "test-doc", requesterDocVersion: {} as any }],
      }

      connection.receive(testMessage)

      expect(hooks.onChannelReceive).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: connection.channelId }),
        testMessage,
      )
    })

    it("should warn when sending to disconnected peer", () => {
      const peerId: PeerID = "333"
      const loggerSpy = vi.spyOn(adapter.logger, "warn")

      const channel = (adapter as any).generate(peerId)
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      channel.send(testMessage)

      expect(loggerSpy).toHaveBeenCalledWith(
        "Tried to send to disconnected peer",
        { peerId },
      )
    })
  })

  describe("SseConnection", () => {
    it("should throw error if send function not set", () => {
      const connection = new SseConnection("444", 1)

      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      expect(() => connection.send(testMessage)).toThrow(
        "Cannot send message: send function not set",
      )
    })

    it("should call disconnect handler when disconnected", () => {
      const connection = new SseConnection("555", 1)
      const disconnectHandler = vi.fn()

      connection.setDisconnectHandler(disconnectHandler)
      connection.disconnect()

      expect(disconnectHandler).toHaveBeenCalled()
    })
  })
})
