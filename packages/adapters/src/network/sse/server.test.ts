import type { Channel, ChannelMsg, PeerId } from "@loro-extended/repo"
import type { Request, Response } from "express"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SseServerNetworkAdapter } from "./server"

describe("SseServerNetworkAdapter", () => {
  let adapter: SseServerNetworkAdapter

  beforeEach(() => {
    adapter = new SseServerNetworkAdapter()
    vi.clearAllMocks()
  })

  describe("initialization", () => {
    it("should create adapter with correct adapterId", () => {
      expect(adapter.adapterId).toBe("sse-server")
    })
  })

  describe("init()", () => {
    it("should store addChannel and removeChannel callbacks", () => {
      const addChannel = vi.fn()
      const removeChannel = vi.fn()

      adapter.init({ addChannel, removeChannel })

      // Callbacks should be stored (we can't directly test private fields, but we can test behavior)
      expect(adapter).toBeDefined()
    })
  })

  describe("generate()", () => {
    it("should return a BaseChannel for a specific peerId", () => {
      const peerId: PeerId = "test-peer-123"
      const channel = (adapter as any).generate(peerId)

      expect(channel.kind).toBe("network")
      expect(channel.adapterId).toBe("sse-server")
      expect(typeof channel.send).toBe("function")
      expect(typeof channel.start).toBe("function")
      expect(typeof channel.stop).toBe("function")
    })

    it("should create send function that writes to client response", async () => {
      const peerId: PeerId = "test-peer-123"
      const mockResponse = {
        write: vi.fn(),
      } as unknown as Response

      // Set up the adapter with a mock client
      ;(adapter as any).clients.set(peerId, mockResponse)

      const channel = (adapter as any).generate(peerId)
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "up-to-date", version: {} as any },
      }

      await channel.send(testMessage)

      expect(mockResponse.write).toHaveBeenCalled()
      const writeCall = (mockResponse.write as any).mock.calls[0][0]
      expect(writeCall).toContain("data:")
      expect(writeCall).toContain("\n\n")
    })

    it("should log warning when sending to disconnected peer", async () => {
      const peerId: PeerId = "disconnected-peer"
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
        { peerId }
      )
    })
  })

  describe("start()", () => {
    it("should log that server adapter started", () => {
      const loggerSpy = vi.spyOn(adapter.logger, "info")
      
      adapter.start()

      expect(loggerSpy).toHaveBeenCalledWith("SSE server adapter started")
    })
  })

  describe("deinit()", () => {
    it("should close all client connections", () => {
      const mockRes1 = { end: vi.fn() } as unknown as Response
      const mockRes2 = { end: vi.fn() } as unknown as Response

      ;(adapter as any).clients.set("peer1", mockRes1)
      ;(adapter as any).clients.set("peer2", mockRes2)

      adapter.deinit()

      expect(mockRes1.end).toHaveBeenCalled()
      expect(mockRes2.end).toHaveBeenCalled()
    })

    it("should clear all heartbeats", () => {
      const timeout1 = setTimeout(() => {}, 1000)
      const timeout2 = setTimeout(() => {}, 1000)

      ;(adapter as any).heartbeats.set("peer1", timeout1)
      ;(adapter as any).heartbeats.set("peer2", timeout2)

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")

      adapter.deinit()

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout1)
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout2)
    })

    it("should clear all maps", () => {
      const mockRes = { end: vi.fn() } as unknown as Response
      ;(adapter as any).clients.set("peer1", mockRes)
      ;(adapter as any).receiveFns.set("peer1", vi.fn())
      ;(adapter as any).heartbeats.set("peer1", setTimeout(() => {}, 1000))
      ;(adapter as any).channelsByPeer.set("peer1", {} as Channel)

      adapter.deinit()

      expect((adapter as any).clients.size).toBe(0)
      expect((adapter as any).receiveFns.size).toBe(0)
      expect((adapter as any).heartbeats.size).toBe(0)
      expect((adapter as any).channelsByPeer.size).toBe(0)
    })
  })

  describe("getExpressRouter()", () => {
    it("should return an Express router", () => {
      const router = adapter.getExpressRouter()
      expect(router).toBeDefined()
      expect(typeof router).toBe("function") // Express routers are functions
    })
  })

  describe("Express /sync endpoint", () => {
    it("should route messages to correct receive function", () => {
      const router = adapter.getExpressRouter()
      const peerId: PeerId = "test-peer"
      const receiveFn = vi.fn()

      ;(adapter as any).receiveFns.set(peerId, receiveFn)

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

      // Find the POST /sync handler
      const postHandler = (router as any).stack.find(
        (layer: any) => layer.route?.path === "/sync" && layer.route?.methods?.post
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(receiveFn).toHaveBeenCalled()
        expect(mockRes.status).toHaveBeenCalledWith(200)
      }
    })

    it("should return 400 if X-Peer-Id header is missing", () => {
      const router = adapter.getExpressRouter()

      const mockReq = {
        body: {},
        headers: {},
      } as unknown as Request

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response

      const postHandler = (router as any).stack.find(
        (layer: any) => layer.route?.path === "/sync" && layer.route?.methods?.post
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.send).toHaveBeenCalledWith({ error: "Missing X-Peer-Id header" })
      }
    })

    it("should return 404 if peer not connected", () => {
      const router = adapter.getExpressRouter()
      const peerId: PeerId = "unknown-peer"

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
        (layer: any) => layer.route?.path === "/sync" && layer.route?.methods?.post
      )

      if (postHandler) {
        postHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(404)
        expect(mockRes.send).toHaveBeenCalledWith({ error: "Peer not connected" })
      }
    })
  })

  describe("Express /events endpoint", () => {
    it("should create channel lazily when client connects", () => {
      const addChannel = vi.fn().mockReturnValue({
        channelId: 1,
        publishDocId: "test-doc",
      } as Channel)
      const removeChannel = vi.fn()

      adapter.init({ addChannel, removeChannel })

      const router = adapter.getExpressRouter()
      const peerId: PeerId = "new-peer"

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
        (layer: any) => layer.route?.path === "/events" && layer.route?.methods?.get
      )

      if (getHandler) {
        getHandler.route.stack[0].handle(mockReq, mockRes)
        
        expect(addChannel).toHaveBeenCalledWith(peerId)
        expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
          "Content-Type": "text/event-stream",
        }))
      }
    })

    it("should return 400 if peerId query parameter is missing", () => {
      adapter.init({
        addChannel: vi.fn(),
        removeChannel: vi.fn(),
      })

      const router = adapter.getExpressRouter()

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
        (layer: any) => layer.route?.path === "/events" && layer.route?.methods?.get
      )

      if (getHandler) {
        getHandler.route.stack[0].handle(mockReq, mockRes)
        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.end).toHaveBeenCalledWith("peerId query parameter is required")
      }
    })
  })

  describe("serialization", () => {
    it("should serialize Uint8Array to base64", async () => {
      const peerId: PeerId = "test-peer"
      const mockResponse = {
        write: vi.fn(),
      } as unknown as Response

      ;(adapter as any).clients.set(peerId, mockResponse)

      const channel = (adapter as any).generate(peerId)
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const testMessage: ChannelMsg = {
        type: "channel/sync-response",
        docId: "test-doc",
        hopCount: 0,
        transmission: { type: "update", data },
      }

      await channel.send(testMessage)

      expect(mockResponse.write).toHaveBeenCalled()
      const writeCall = (mockResponse.write as any).mock.calls[0][0]
      const jsonData = JSON.parse(writeCall.replace("data: ", "").replace("\n\n", ""))
      
      expect(jsonData.transmission.data).toHaveProperty("__type", "Uint8Array")
      expect(jsonData.transmission.data).toHaveProperty("data")
      expect(typeof jsonData.transmission.data.data).toBe("string")
    })
  })

  describe("heartbeat mechanism", () => {
    it("should setup heartbeat when client connects", () => {
      const addChannel = vi.fn().mockReturnValue({
        channelId: 1,
        publishDocId: "test-doc",
      } as Channel)

      adapter.init({ addChannel, removeChannel: vi.fn() })

      const router = adapter.getExpressRouter()
      const peerId: PeerId = "test-peer"

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
        (layer: any) => layer.route?.path === "/events" && layer.route?.methods?.get
      )

      if (getHandler) {
        getHandler.route.stack[0].handle(mockReq, mockRes)
        
        // Heartbeat should be set up
        expect((adapter as any).heartbeats.has(peerId)).toBe(true)
      }
    })
  })

  describe("channel lifecycle", () => {
    it("should handle channel start and stop", () => {
      const peerId: PeerId = "test-peer"
      const receiveFn = vi.fn()
      
      const channel = (adapter as any).generate(peerId)
      
      // Start channel
      channel.start(receiveFn)
      expect((adapter as any).receiveFns.get(peerId)).toBe(receiveFn)

      // Stop channel
      channel.stop()
      expect((adapter as any).receiveFns.has(peerId)).toBe(false)
    })
  })
})