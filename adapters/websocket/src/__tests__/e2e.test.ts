/**
 * End-to-end tests for the native WebSocket adapter.
 */

import { change, Repo, Shape, validatePeerId } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { WsClientNetworkAdapter } from "../client.js"
import { WsServerNetworkAdapter, wrapWsSocket } from "../server-adapter.js"

describe("WebSocket Adapter E2E", () => {
  let wss: WebSocketServer
  let serverAdapter: WsServerNetworkAdapter
  let clientAdapter1: WsClientNetworkAdapter
  let clientAdapter2: WsClientNetworkAdapter
  let serverRepo: Repo
  let clientRepo1: Repo
  let clientRepo2: Repo
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
    wss.on("connection", (ws, req) => {
      if (!req.url) throw new Error("request URL is required")
      const url = new URL(req.url, `http://localhost:${port}`)
      const peerId = url.searchParams.get("peerId")
      if (!peerId) {
        throw new Error("peerId is required")
      }
      validatePeerId(peerId)

      const { start } = serverAdapter.handleConnection({
        socket: wrapWsSocket(ws),
        peerId: peerId || undefined,
      })

      start()
    })

    // Setup repos
    serverRepo = new Repo({
      identity: { peerId: "1000", name: "server", type: "service" },
      adapters: [serverAdapter],
    })

    clientAdapter1 = new WsClientNetworkAdapter({
      url: `ws://localhost:${port}?peerId=2000`,
      reconnect: { enabled: false },
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    })
    clientRepo1 = new Repo({
      identity: { peerId: "2000", name: "client-1", type: "user" },
      adapters: [clientAdapter1],
    })

    clientAdapter2 = new WsClientNetworkAdapter({
      url: `ws://localhost:${port}?peerId=3000`,
      reconnect: { enabled: false },
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    })
    clientRepo2 = new Repo({
      identity: { peerId: "3000", name: "client-2", type: "user" },
      adapters: [clientAdapter2],
    })
  })

  afterEach(async () => {
    // Cleanup
    await clientAdapter1.onStop()
    await clientAdapter2.onStop()
    await serverAdapter.onStop()

    wss.close()
  })

  it("should sync document changes between clients via server", async () => {
    const docId = "test-doc"

    // Define a simple doc schema
    const DocSchema = Shape.doc({
      text: Shape.text(),
    })

    // Wait for both clients to connect
    await new Promise<void>(resolve => {
      const checkConnected = () => {
        if (clientAdapter1.isConnected && clientAdapter2.isConnected) {
          resolve()
        } else {
          setTimeout(checkConnected, 50)
        }
      }
      checkConnected()
    })

    // Server also needs to have the document for relay to work
    serverRepo.getHandle(docId, DocSchema)

    // Both clients need to "join" the document
    const handle1 = clientRepo1.getHandle(docId, DocSchema)
    const handle2 = clientRepo2.getHandle(docId, DocSchema)

    // Wait for all parties to sync
    await new Promise(resolve => setTimeout(resolve, 500))

    // Client 1 makes changes
    change(handle1.doc, draft => {
      draft.text.insert(0, "Hello")
    })

    // Wait for sync to propagate
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 5000)

      // Check if already synced
      const text = handle2.loroDoc.getText("text")
      if (text && text.toString() === "Hello") {
        clearTimeout(timeout)
        resolve()
        return
      }

      handle2.subscribe(() => {
        const text = handle2.loroDoc.getText("text")
        if (text && text.toString() === "Hello") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(handle2.loroDoc.getText("text").toString()).toBe("Hello")
  }, 10000)

  it.skip("should handle reconnection", async () => {
    // This test is skipped for now as reconnection testing is complex
  })
})
