import { Repo, validatePeerId } from "@loro-extended/repo"
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

    // Client 1 creates doc and makes changes
    const handle1 = clientRepo1.get(docId)
    handle1.batch((doc: any) => {
      const text = doc.getText("text")
      text.insert(0, "Hello")
    })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client 2 should receive changes
    const handle2 = clientRepo2.get(docId)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 5000)

      // Check if already synced
      const text = handle2.doc.getText("text")
      if (text && text.toString() === "Hello") {
        clearTimeout(timeout)
        resolve()
        return
      }

      handle2.doc.subscribe((_event: any) => {
        const text = handle2.doc.getText("text")
        if (text && text.toString() === "Hello") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(handle2.doc.getText("text").toString()).toBe("Hello")
  }, 10000)

  it("should sync ephemeral presence", async () => {
    const docId = "presence-doc"

    // Both clients join the document
    const handle1 = clientRepo1.get(docId)
    const handle2 = clientRepo2.get(docId)

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Client 1 sets presence
    const presence1 = handle1.presence

    // Client 2 listens for presence
    const presence2 = handle2.presence

    const presencePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Presence timeout")),
        5000,
      )
      presence2.subscribe((peers: any) => {
        const peer1Presence = peers["2000"] // client-1 peerId
        if (peer1Presence && peer1Presence.cursor === 10) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    presence1.set({ cursor: 10 })

    await presencePromise
  }, 10000)
})
