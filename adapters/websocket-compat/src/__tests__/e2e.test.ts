import {
  change,
  loro,
  Repo,
  Shape,
  sync,
  validatePeerId,
} from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { WsClientNetworkAdapter } from "../client.js"
import { WsServerNetworkAdapter, wrapWsSocket } from "../server.js"

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
    port = (wss.address() as any).port

    // Setup server adapter
    serverAdapter = new WsServerNetworkAdapter()
    wss.on("connection", (ws, req) => {
      if (!req.url) throw new Error(`request URL is required`)
      const url = new URL(req.url, `http://localhost:${port}`)
      const peerId = url.searchParams.get("peerId")
      if (!peerId) {
        throw new Error(`peerId is required`)
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
      WebSocket: WebSocket as any,
    })
    clientRepo1 = new Repo({
      identity: { peerId: "2000", name: "client-1", type: "user" },
      adapters: [clientAdapter1],
    })

    clientAdapter2 = new WsClientNetworkAdapter({
      url: `ws://localhost:${port}?peerId=3000`,
      reconnect: { enabled: false },
      WebSocket: WebSocket as any,
    })
    clientRepo2 = new Repo({
      identity: { peerId: "3000", name: "client-2", type: "user" },
      adapters: [clientAdapter2],
    })
  })

  afterEach(async () => {
    // Cleanup
    // We need to be careful about cleanup order to avoid hanging handles
    // Repos first, then adapters/server

    // Note: Repo doesn't have a stop method exposed publicly in types usually,
    // but adapters do.

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
    // The server acts as a hub - it needs to know about the document
    serverRepo.get(docId, DocSchema)

    // Both clients need to "join" the document
    const doc1 = clientRepo1.get(docId, DocSchema)
    const doc2 = clientRepo2.get(docId, DocSchema)

    // Wait for all parties to sync
    await new Promise(resolve => setTimeout(resolve, 500))

    // Client 1 makes changes
    change(doc1, draft => {
      draft.text.insert(0, "Hello")
    })

    // Wait for sync to propagate
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 5000)

      // Check if already synced
      const text = sync(doc2).loroDoc.getText("text")
      if (text && text.toString() === "Hello") {
        clearTimeout(timeout)
        resolve()
        return
      }

      loro(doc2).subscribe(() => {
        const text = loro(doc2).getText("text")
        if (text && text.toString() === "Hello") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(sync(doc2).loroDoc.getText("text").toString()).toBe("Hello")
  }, 10000)

  // TODO: Ephemeral presence sync over websocket needs investigation
  // The namespaced store model requires proper JSON serialization of namespace field
  it.skip("should sync ephemeral presence", async () => {
    const docId = "presence-doc"

    // Define a simple doc schema with presence
    const DocSchema = Shape.doc({
      text: Shape.text(),
    })
    const PresenceSchema = Shape.plain.struct({
      cursor: Shape.plain.number(),
    })

    // Both clients join the document
    const doc1 = clientRepo1.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    const doc2 = clientRepo2.get(docId, DocSchema, {
      presence: PresenceSchema,
    })

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client 1 sets presence
    const presence1 = sync(doc1).presence

    // Client 2 listens for presence
    const presence2 = sync(doc2).presence

    // Set presence first, then subscribe
    presence1.setSelf({ cursor: 10 })

    // Wait a bit for sync
    await new Promise(resolve => setTimeout(resolve, 200))

    // Client 2 should see client 1's presence
    expect(presence2.get("2000")).toEqual({ cursor: 10 })
  }, 10000)

  it.skip("should handle reconnection", async () => {
    // This test is skipped for now as reconnection testing is complex
  })
})
