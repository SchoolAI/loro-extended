/**
 * Tests for the WebSocket "ready signal" pattern.
 *
 * These tests verify that the client waits for the server's "ready" signal
 * before creating its channel. This prevents a race condition where the client
 * might send messages before the server is fully set up.
 */

import { Repo, validatePeerId } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws"
import { WsClientNetworkAdapter } from "../client.js"
import { WsServerNetworkAdapter, wrapWsSocket } from "../server-adapter.js"

describe("WebSocket Ready Signal", () => {
  let wss: WebSocketServer
  let serverAdapter: WsServerNetworkAdapter
  let port: number

  beforeEach(async () => {
    // Start WebSocket server
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => {
      wss.on("listening", resolve)
    })
    port = (wss.address() as { port: number }).port

    // Setup server adapter
    serverAdapter = new WsServerNetworkAdapter()
  })

  afterEach(async () => {
    await serverAdapter.onStop()
    wss.close()
  })

  describe("Client waits for ready signal", () => {
    it("should not create channel until server sends ready signal", async () => {
      // This test verifies the core invariant: the client must wait for "ready"
      // before creating its channel.
      //
      // BEFORE THE FIX: This test would have failed because the client created
      // the channel immediately in the WebSocket 'open' event handler.

      let clientAdapter: WsClientNetworkAdapter | undefined

      // Track when the client creates its channel
      let channelCreatedBeforeReady = false
      let readySignalSent = false

      // Setup server to delay the ready signal
      wss.on("connection", (ws: WsWebSocket, req) => {
        if (!req.url) throw new Error("request URL is required")
        const url = new URL(req.url, `http://localhost:${port}`)
        const peerId = url.searchParams.get("peerId")
        if (!peerId) throw new Error("peerId is required")
        validatePeerId(peerId)

        const { start } = serverAdapter.handleConnection({
          socket: wrapWsSocket(ws),
          peerId,
        })

        // Check if client has a channel BEFORE we call start() (which sends "ready")
        // We need to wait a tick to let the client's 'open' handler run
        setTimeout(() => {
          // At this point, the client's WebSocket is open but we haven't sent "ready"
          // The client should NOT have a channel yet
          if (clientAdapter && (clientAdapter as any).serverChannel) {
            channelCreatedBeforeReady = true
          }

          // Now send the ready signal
          start()
          readySignalSent = true
        }, 50)
      })

      // Create server repo (needed to initialize the adapter)
      new Repo({
        identity: { peerId: "1000", name: "server", type: "service" },
        adapters: [serverAdapter],
      })

      // Create client adapter
      clientAdapter = new WsClientNetworkAdapter({
        url: `ws://localhost:${port}?peerId=2000`,
        reconnect: { enabled: false },
        WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
      })

      // Create client repo (this starts the adapter)
      const _clientRepo = new Repo({
        identity: { peerId: "2000", name: "client", type: "user" },
        adapters: [clientAdapter],
      })

      // Wait for connection to be fully established
      await new Promise<void>(resolve => {
        const check = () => {
          if (clientAdapter?.isConnected && readySignalSent) {
            // Give a bit more time for the ready signal to be processed
            setTimeout(resolve, 100)
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      // Verify the invariant: channel was NOT created before ready signal
      expect(channelCreatedBeforeReady).toBe(false)

      // Verify the channel exists now (after ready signal)
      expect((clientAdapter as any).serverChannel).toBeDefined()
      expect((clientAdapter as any).serverReady).toBe(true)

      // Cleanup
      await clientAdapter.onStop()
    })

    it("should establish channel and sync after receiving ready signal", async () => {
      // This test verifies the happy path: after receiving "ready",
      // the client can successfully sync documents.

      let clientAdapter: WsClientNetworkAdapter | undefined

      // Normal server setup - calls start() immediately
      wss.on("connection", (ws: WsWebSocket, req) => {
        if (!req.url) throw new Error("request URL is required")
        const url = new URL(req.url, `http://localhost:${port}`)
        const peerId = url.searchParams.get("peerId")
        if (!peerId) throw new Error("peerId is required")
        validatePeerId(peerId)

        const { start } = serverAdapter.handleConnection({
          socket: wrapWsSocket(ws),
          peerId,
        })
        start()
      })

      // Create repos
      const _serverRepo = new Repo({
        identity: { peerId: "1000", name: "server", type: "service" },
        adapters: [serverAdapter],
      })

      clientAdapter = new WsClientNetworkAdapter({
        url: `ws://localhost:${port}?peerId=2000`,
        reconnect: { enabled: false },
        WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
      })

      const _clientRepo = new Repo({
        identity: { peerId: "2000", name: "client", type: "user" },
        adapters: [clientAdapter],
      })

      // Wait for connection
      await new Promise<void>(resolve => {
        const check = () => {
          if (
            clientAdapter?.isConnected &&
            (clientAdapter as any).serverReady
          ) {
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      // Verify channel is established
      expect((clientAdapter as any).serverChannel).toBeDefined()
      expect((clientAdapter as any).serverReady).toBe(true)
      expect(clientAdapter.connectionState).toBe("connected")

      // Cleanup
      await clientAdapter.onStop()
    })
  })

  describe("Reconnection resets serverReady", () => {
    it("should reset serverReady on disconnect and wait for new ready signal on reconnect", async () => {
      // This test verifies that reconnection works correctly:
      // 1. Connect and verify serverReady is true
      // 2. Disconnect and verify serverReady is false
      // 3. Reconnect and verify we wait for new ready signal

      let clientAdapter: WsClientNetworkAdapter | undefined
      let connectionCount = 0

      // Server setup
      wss.on("connection", (ws: WsWebSocket, req) => {
        connectionCount++
        if (!req.url) throw new Error("request URL is required")
        const url = new URL(req.url, `http://localhost:${port}`)
        const peerId = url.searchParams.get("peerId")
        if (!peerId) throw new Error("peerId is required")
        validatePeerId(peerId)

        const { start } = serverAdapter.handleConnection({
          socket: wrapWsSocket(ws),
          peerId,
        })
        start()
      })

      // Create server repo
      const _serverRepo = new Repo({
        identity: { peerId: "1000", name: "server", type: "service" },
        adapters: [serverAdapter],
      })

      // Create client with reconnect enabled
      clientAdapter = new WsClientNetworkAdapter({
        url: `ws://localhost:${port}?peerId=2000`,
        reconnect: { enabled: true, baseDelay: 100, maxAttempts: 3 },
        WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
      })

      const _clientRepo = new Repo({
        identity: { peerId: "2000", name: "client", type: "user" },
        adapters: [clientAdapter],
      })

      // Wait for initial connection
      await new Promise<void>(resolve => {
        const check = () => {
          if (
            clientAdapter?.isConnected &&
            (clientAdapter as any).serverReady
          ) {
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      // Verify initial state
      expect((clientAdapter as any).serverReady).toBe(true)
      expect(connectionCount).toBe(1)

      // Force disconnect by closing the server-side connection
      const connections = serverAdapter.getAllConnections()
      expect(connections.length).toBe(1)
      connections[0].close(1000, "Test disconnect")

      // Wait for disconnect to be processed
      await new Promise<void>(resolve => {
        const check = () => {
          if (!clientAdapter?.isConnected) {
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      // Verify serverReady is reset
      expect((clientAdapter as any).serverReady).toBe(false)
      expect((clientAdapter as any).serverChannel).toBeUndefined()

      // Wait for reconnection
      await new Promise<void>(resolve => {
        const check = () => {
          if (
            clientAdapter?.isConnected &&
            (clientAdapter as any).serverReady &&
            connectionCount === 2
          ) {
            resolve()
          } else {
            setTimeout(check, 50)
          }
        }
        check()
      })

      // Verify reconnection worked
      expect((clientAdapter as any).serverReady).toBe(true)
      expect((clientAdapter as any).serverChannel).toBeDefined()
      expect(connectionCount).toBe(2)

      // Cleanup
      await clientAdapter.onStop()
    })
  })
})
