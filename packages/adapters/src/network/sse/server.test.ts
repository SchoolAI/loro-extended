import type { AdapterHooks, ChannelMsg, PeerID } from "@loro-extended/repo"
import type { Request, Response } from "express"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSseExpressRouter, SseServerNetworkAdapter } from "./server"

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

  describe("generate()", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should return a GeneratedChannel for a specific peerId", () => {
      const peerId: PeerID = "123"
      const channel = (adapter as any).generate(peerId)

      expect(channel.kind).toBe("network")
      expect(channel.adapterId).toBe("sse-server")
      expect(typeof channel.send).toBe("function")
      expect(typeof channel.stop).toBe("function")
    })

    it("should log warning when sending to disconnected peer", async () => {
      const peerId: PeerID = "456"
      const channel = (adapter as any).generate(peerId)

      const loggerSpy = vi.spyOn(adapter.logger, "warn")

      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      await channel.send(testMessage)

      expect(loggerSpy).toHaveBeenCalledWith(
        "Tried to send to disconnected peer",
        { peerId },
      )
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

      const conn1 = adapter.registerConnection("1" as PeerID)
      const conn2 = adapter.registerConnection("2" as PeerID)

      const disconnectSpy1 = vi.fn()
      const disconnectSpy2 = vi.fn()
      conn1.setDisconnectHandler(disconnectSpy1)
      conn2.setDisconnectHandler(disconnectSpy2)

      await adapter._stop()

      expect(disconnectSpy1).toHaveBeenCalled()
      expect(disconnectSpy2).toHaveBeenCalled()
    })
  })

  describe("createSseExpressRouter()", () => {
    it("should return an Express router", () => {
      const router = createSseExpressRouter(adapter)
      expect(router).toBeDefined()
      expect(typeof router).toBe("function") // Express routers are functions
    })
  })

  describe("Express /sync endpoint", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should route messages to correct connection", () => {
      const router = createSseExpressRouter(adapter)
      const peerId: PeerID = "789"

      const connection = adapter.registerConnection(peerId)
      const receiveSpy = vi.spyOn(connection, "receive")

      const mockReq = {
        body: {
          type: "channel/sync-request",
          docs: [{ docId: "test-doc", requesterDocVersion: {} }],
        },
        headers: {
          "x-peer-id": peerId,
        },
      } as unknown as Request

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response

      const postHandler = (router as any).stack.find(
        (layer: any) =>
          layer.route?.path === "/sync" && layer.route?.methods?.post,
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(receiveSpy).toHaveBeenCalled()
        expect(mockRes.status).toHaveBeenCalledWith(200)
      }
    })

    it("should return 400 if X-Peer-Id header is missing", () => {
      const router = createSseExpressRouter(adapter)

      const mockReq = {
        body: {},
        headers: {},
      } as unknown as Request

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response

      const postHandler = (router as any).stack.find(
        (layer: any) =>
          layer.route?.path === "/sync" && layer.route?.methods?.post,
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.send).toHaveBeenCalledWith({ error: "Missing peer ID" })
      }
    })

    it("should return 404 if peer not connected", () => {
      const router = createSseExpressRouter(adapter)
      const peerId: PeerID = "999"

      const mockReq = {
        body: {},
        headers: {
          "x-peer-id": peerId,
        },
      } as unknown as Request

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response

      const postHandler = (router as any).stack.find(
        (layer: any) =>
          layer.route?.path === "/sync" && layer.route?.methods?.post,
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(404)
        expect(mockRes.send).toHaveBeenCalledWith({
          error: "Peer not connected",
        })
      }
    })
  })

  describe("Express /events endpoint", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should create connection when client connects", () => {
      const router = createSseExpressRouter(adapter)
      const peerId: PeerID = "111"

      const mockReq = {
        query: { peerId },
        on: vi.fn(),
      } as unknown as Request

      const mockRes = {
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn(),
      } as unknown as Response

      const getHandler = (router as any).stack.find(
        (layer: any) =>
          layer.route?.path === "/events" && layer.route?.methods?.get,
      )

      if (getHandler) {
        getHandler.route.stack[0].handle(mockReq, mockRes)

        expect(adapter.isConnected(peerId)).toBe(true)
        expect(mockRes.writeHead).toHaveBeenCalledWith(
          200,
          expect.objectContaining({
            "Content-Type": "text/event-stream",
          }),
        )
      }
    })

    it("should return 400 if peerId query parameter is missing", () => {
      const router = createSseExpressRouter(adapter)

      const mockReq = {
        query: {},
        on: vi.fn(),
      } as unknown as Request

      const mockRes = {
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        status: vi.fn().mockReturnThis(),
        end: vi.fn(),
      } as unknown as Response

      const getHandler = (router as any).stack.find(
        (layer: any) =>
          layer.route?.path === "/events" && layer.route?.methods?.get,
      )

      if (getHandler) {
        getHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.end).toHaveBeenCalledWith("peerId is required")
      }
    })
  })

  describe("serialization", () => {
    beforeEach(async () => {
      await adapter._start()
    })

    it("should serialize Uint8Array to base64", () => {
      const peerId: PeerID = "222"
      const connection = adapter.registerConnection(peerId)

      const mockWrite = vi.fn()
      connection.setSendFunction(msg => {
        mockWrite(msg)
      })

      const data = new Uint8Array([1, 2, 3, 4, 5])
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "update", data },
      }

      connection.send(testMessage)

      expect(mockWrite).toHaveBeenCalledWith(testMessage)
    })
  })
})
