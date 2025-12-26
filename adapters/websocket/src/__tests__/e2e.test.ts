import { Repo, Shape, validatePeerId } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { WsClientNetworkAdapter } from "../client.js"
import { WsServerNetworkAdapter, wrapWsSocket } from "../server.js"

describe("WebSocket Adapter E2E", () => {
  let wss: WebSocketServer
  let serverAdapter: WsServerNetworkAdapter
  let clientAdapter1: WsClientNetworkAdapter
  let clientAdapter2: WsClientNetworkAdapter
  let _serverRepo: Repo
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
    _serverRepo = new Repo({
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

    // Client 1 creates doc and makes changes
    const handle1 = clientRepo1.get(docId, DocSchema)
    handle1.change(draft => {
      draft.text.insert(0, "Hello")
    })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client 2 should receive changes
    const handle2 = clientRepo2.get(docId, DocSchema)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 5000)

      // Check if already synced
      const text = handle2.loroDoc.getText("text")
      if (text && text.toString() === "Hello") {
        clearTimeout(timeout)
        resolve()
        return
      }

      handle2.subscribe((_event: any) => {
        const text = handle2.loroDoc.getText("text")
        if (text && text.toString() === "Hello") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(handle2.loroDoc.getText("text").toString()).toBe("Hello")
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
    const handle1 = clientRepo1.get(docId, DocSchema, {
      presence: PresenceSchema,
    })
    const handle2 = clientRepo2.get(docId, DocSchema, {
      presence: PresenceSchema,
    })

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client 1 sets presence
    const presence1 = handle1.presence

    // Client 2 listens for presence
    const presence2 = handle2.presence

    // Set presence first, then subscribe
    presence1.setSelf({ cursor: 10 })

    // Wait a bit for sync
    await new Promise(resolve => setTimeout(resolve, 200))

    const presencePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Presence timeout")),
        5000,
      )

      // Check if already synced (from initial state)
      const peer1Presence = presence2.get("2000")
      if (peer1Presence?.cursor === 10) {
        clearTimeout(timeout)
        resolve()
        return
      }

      presence2.subscribe(event => {
        // Check if peer1 (peerId "2000") has cursor 10
        if (event.key === "2000" && event.value?.cursor === 10) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    await presencePromise
  }, 10000)
})
