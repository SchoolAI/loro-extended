/**
 * Hub-spoke synchronization test for native WebSocket adapter.
 *
 * This test replicates the todo-websocket example scenario where:
 * 1. Server acts as a hub/relay (does NOT explicitly get documents)
 * 2. Two clients connect to the server
 * 3. Client 1 creates a document and makes changes
 * 4. Client 2 should see the changes via the server relay
 *
 * The native adapter should handle this without the translation issues
 * that affected the compat adapter (e.g., dropped batch messages).
 */

import {
  change,
  loro,
  type PeerID,
  Repo,
  Shape,
  sync,
} from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { WsClientNetworkAdapter } from "../client.js"
import { WsServerNetworkAdapter, wrapWsSocket } from "../server-adapter.js"

describe("Hub-Spoke Synchronization (Server as Relay)", () => {
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

      const { start } = serverAdapter.handleConnection({
        socket: wrapWsSocket(ws),
        peerId: (peerId || undefined) as PeerID | undefined,
      })

      start()
    })

    // Setup server repo - NOTE: Server does NOT explicitly get documents
    // This is the key difference from the passing e2e.test.ts
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
    await clientAdapter1.onStop()
    await clientAdapter2.onStop()
    await serverAdapter.onStop()
    wss.close()
  })

  it("should sync document changes between clients via server relay (without server.get)", async () => {
    const docId = "test-doc-hub-spoke"

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

    // NOTE: Server does NOT call serverRepo.get(docId, DocSchema)
    // This is the key difference - the server acts purely as a relay

    // Both clients join the document
    const doc1 = clientRepo1.get(docId, DocSchema)
    const doc2 = clientRepo2.get(docId, DocSchema)

    // Wait for initial sync
    await new Promise(resolve => setTimeout(resolve, 500))

    // Client 1 makes changes
    change(doc1, draft => {
      draft.text.insert(0, "Hello from client 1")
    })

    // Wait for sync to propagate through server to client 2
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `Sync timeout - client2 text is: "${sync(doc2).loroDoc.getText("text")?.toString()}"`,
            ),
          ),
        5000,
      )

      // Check if already synced
      const text = sync(doc2).loroDoc.getText("text")
      if (text && text.toString() === "Hello from client 1") {
        clearTimeout(timeout)
        resolve()
        return
      }

      loro(doc2).subscribe(() => {
        const text = loro(doc2).getText("text")
        if (text && text.toString() === "Hello from client 1") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(sync(doc2).loroDoc.getText("text").toString()).toBe(
      "Hello from client 1",
    )
  }, 10000)

  it("should sync when server explicitly gets the document (control test)", async () => {
    const docId = "test-doc-with-server-get"

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

    // Server explicitly gets the document - this is what makes the e2e.test.ts pass
    serverRepo.get(docId, DocSchema)

    // Both clients join the document
    const doc1 = clientRepo1.get(docId, DocSchema)
    const doc2 = clientRepo2.get(docId, DocSchema)

    // Wait for initial sync
    await new Promise(resolve => setTimeout(resolve, 500))

    // Client 1 makes changes
    change(doc1, draft => {
      draft.text.insert(0, "Hello from client 1")
    })

    // Wait for sync to propagate through server to client 2
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `Sync timeout - client2 text is: "${sync(doc2).loroDoc.getText("text")?.toString()}"`,
            ),
          ),
        5000,
      )

      // Check if already synced
      const text = sync(doc2).loroDoc.getText("text")
      if (text && text.toString() === "Hello from client 1") {
        clearTimeout(timeout)
        resolve()
        return
      }

      loro(doc2).subscribe(() => {
        const text = loro(doc2).getText("text")
        if (text && text.toString() === "Hello from client 1") {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(sync(doc2).loroDoc.getText("text").toString()).toBe(
      "Hello from client 1",
    )
  }, 10000)
})
