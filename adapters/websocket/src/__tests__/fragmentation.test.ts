/**
 * Integration tests for WebSocket fragmentation with large payloads.
 *
 * These tests verify that payloads exceeding the fragment threshold
 * are correctly fragmented, transmitted, and reassembled.
 *
 * Uses a small fragment threshold (10KB) for fast test execution while
 * still exercising all fragmentation code paths.
 */

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
import { WsServerNetworkAdapter, wrapWsSocket } from "../server-adapter.js"

describe("WebSocket Fragmentation", () => {
  let wss: WebSocketServer
  let serverAdapter: WsServerNetworkAdapter
  let clientAdapter: WsClientNetworkAdapter
  let serverRepo: Repo
  let clientRepo: Repo
  let port: number

  // Use a small fragment threshold for testing (10KB instead of default 100KB)
  const TEST_FRAGMENT_THRESHOLD = 10 * 1024

  beforeEach(async () => {
    // Start WebSocket server
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => {
      wss.on("listening", resolve)
    })
    port = (wss.address() as { port: number }).port

    // Setup server adapter with test threshold
    serverAdapter = new WsServerNetworkAdapter({
      fragmentThreshold: TEST_FRAGMENT_THRESHOLD,
    })

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
        peerId,
      })

      start()
    })

    // Setup server repo
    serverRepo = new Repo({
      identity: { peerId: "1000", name: "server", type: "service" },
      adapters: [serverAdapter],
    })

    // Setup client adapter with test threshold
    clientAdapter = new WsClientNetworkAdapter({
      url: `ws://localhost:${port}?peerId=2000`,
      reconnect: { enabled: false },
      fragmentThreshold: TEST_FRAGMENT_THRESHOLD,
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    })

    clientRepo = new Repo({
      identity: { peerId: "2000", name: "client", type: "user" },
      adapters: [clientAdapter],
    })
  })

  afterEach(async () => {
    await clientAdapter.onStop()
    await serverAdapter.onStop()
    wss.close()
  })

  /**
   * Wait for the client to be fully ready (WebSocket open + handshake complete).
   */
  async function waitForClientReady(timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (!clientAdapter.isReady) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("Timeout waiting for client to be ready")
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  /**
   * Wait for a document's text field to reach expected length.
   */
  async function waitForTextSync(
    doc: ReturnType<typeof clientRepo.get>,
    expectedLength: number,
    timeoutMs = 15000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error(`Sync timeout waiting for ${expectedLength} chars`)),
        timeoutMs,
      )

      const checkSync = () => {
        const text = sync(doc).loroDoc.getText("text")
        if (text && text.toString().length === expectedLength) {
          clearTimeout(timeout)
          resolve()
        }
      }

      checkSync()
      loro(doc).subscribe(() => checkSync())
    })
  }

  const DocSchema = Shape.doc({ text: Shape.text() })

  describe("Large payload sync (parameterized by size)", () => {
    // Test various payload sizes that exercise different fragment counts
    const testCases = [
      { sizeKB: 15, description: "1-2 fragments" },
      { sizeKB: 50, description: "5+ fragments" },
      { sizeKB: 150, description: "15+ fragments (production-scale)" },
    ]

    it.each(testCases)("should sync $sizeKB KB payload ($description)", async ({
      sizeKB,
    }) => {
      const docId = `large-doc-${sizeKB}kb`
      const payloadSize = sizeKB * 1024

      await waitForClientReady()

      // Create doc on server with large content
      const serverDoc = serverRepo.get(docId, DocSchema)
      const largeText = "X".repeat(payloadSize)

      change(serverDoc, draft => {
        draft.text.insert(0, largeText)
      })

      // Client joins and syncs
      const clientDoc = clientRepo.get(docId, DocSchema)
      await waitForTextSync(clientDoc, payloadSize)

      const receivedText = sync(clientDoc).loroDoc.getText("text").toString()
      expect(receivedText.length).toBe(payloadSize)
      expect(receivedText).toBe(largeText)
    }, 30000)
  })

  describe("Bidirectional sync", () => {
    it("should sync large payload from client to server (upload)", async () => {
      const docId = "client-upload-doc"
      const payloadSize = 20 * 1024

      await waitForClientReady()

      // Server creates the doc first (so it exists for sync)
      const serverDoc = serverRepo.get(docId, DocSchema)

      // Client creates document with large content
      const clientDoc = clientRepo.get(docId, DocSchema)

      // Wait for initial sync
      await new Promise(resolve => setTimeout(resolve, 500))

      // Create large content on client
      const largeText = "U".repeat(payloadSize)
      change(clientDoc, draft => {
        draft.text.insert(0, largeText)
      })

      // Wait for sync to server
      await waitForTextSync(serverDoc, payloadSize)

      const receivedText = sync(serverDoc).loroDoc.getText("text").toString()
      expect(receivedText.length).toBe(payloadSize)
      expect(receivedText).toBe(largeText)
    }, 15000)
  })

  describe("Boundary conditions", () => {
    const boundaryTestCases = [
      { sizeKB: 8, shouldFragment: false, description: "under threshold" },
      { sizeKB: 11, shouldFragment: true, description: "over threshold" },
    ]

    it.each(
      boundaryTestCases,
    )("should handle $sizeKB KB payload ($description)", async ({ sizeKB }) => {
      const docId = `boundary-doc-${sizeKB}kb`
      const payloadSize = sizeKB * 1024

      await waitForClientReady()

      const serverDoc = serverRepo.get(docId, DocSchema)
      const text = "B".repeat(payloadSize)

      change(serverDoc, draft => {
        draft.text.insert(0, text)
      })

      const clientDoc = clientRepo.get(docId, DocSchema)
      await waitForTextSync(clientDoc, payloadSize)

      const receivedText = sync(clientDoc).loroDoc.getText("text").toString()
      expect(receivedText.length).toBe(payloadSize)
      expect(receivedText).toBe(text)
    }, 10000)
  })

  describe("Mixed payload scenarios", () => {
    it("should handle interleaved small and large messages", async () => {
      const docId = "mixed-size-doc"

      const MixedSchema = Shape.doc({
        text: Shape.text(),
        counter: Shape.counter(),
      })

      await waitForClientReady()

      // Create doc on both sides
      const serverDoc = serverRepo.get(docId, MixedSchema)
      const clientDoc = clientRepo.get(docId, MixedSchema)

      // Wait for initial sync
      await new Promise(resolve => setTimeout(resolve, 500))

      // Interleave small and large changes
      change(serverDoc, draft => {
        draft.counter.increment(1)
      })

      const largeTextSize = 15 * 1024
      change(serverDoc, draft => {
        draft.text.insert(0, "L".repeat(largeTextSize))
      })

      change(serverDoc, draft => {
        draft.counter.increment(2)
      })

      // Wait for all syncs
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Sync timeout")),
          10000,
        )

        const checkSync = () => {
          const syncedDoc = sync(clientDoc)
          const text = syncedDoc.loroDoc.getText("text")
          const counter = syncedDoc.loroDoc.getCounter("counter")

          if (
            text &&
            text.toString().length === largeTextSize &&
            counter &&
            counter.value === 3
          ) {
            clearTimeout(timeout)
            resolve()
          }
        }

        checkSync()
        loro(clientDoc).subscribe(() => checkSync())
      })

      const syncedDoc = sync(clientDoc)
      expect(syncedDoc.loroDoc.getText("text").toString().length).toBe(
        largeTextSize,
      )
      expect(syncedDoc.loroDoc.getCounter("counter").value).toBe(3)
    }, 15000)
  })
})
