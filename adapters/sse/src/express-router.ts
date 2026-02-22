import type { ChannelMsg, PeerID } from "@loro-extended/repo"
import { serializeChannelMsg } from "@loro-extended/repo"
import type { Request, Response, Router } from "express"
import express from "express"
import type { SseServerNetworkAdapter } from "./server-adapter.js"
import { parsePostBody } from "./sse-handler.js"

export interface SseExpressRouterOptions {
  /**
   * Path for the sync endpoint where clients POST messages.
   * @default "/sync"
   */
  syncPath?: string

  /**
   * Path for the events endpoint where clients connect via SSE.
   * @default "/events"
   */
  eventsPath?: string

  /**
   * Interval in milliseconds for sending heartbeat comments to keep connections alive.
   * @default 30000 (30 seconds)
   */
  heartbeatInterval?: number

  /**
   * Custom function to extract peerId from the sync request.
   * By default, reads from the "x-peer-id" header.
   */
  getPeerIdFromSyncRequest?: (req: Request) => PeerID | undefined

  /**
   * Custom function to extract peerId from the events request.
   * By default, reads from the "peerId" query parameter.
   */
  getPeerIdFromEventsRequest?: (req: Request) => PeerID | undefined
}

/**
 * Create an Express router for SSE server adapter.
 *
 * This factory function creates Express routes that integrate with the
 * SseServerNetworkAdapter. It handles:
 * - POST endpoint for clients to send binary CBOR messages to the server
 * - GET endpoint for clients to establish SSE connections
 * - Heartbeat mechanism to detect stale connections
 * - Message serialization/deserialization
 *
 * ## Wire Format
 *
 * The POST endpoint accepts binary CBOR with transport-layer prefixes:
 * - `Content-Type: application/octet-stream`
 * - Body contains MESSAGE_COMPLETE (0x00) or FRAGMENT_HEADER/DATA (0x01/0x02) prefixed data
 *
 * The SSE endpoint sends JSON messages (SSE is text-only).
 *
 * @param adapter The SseServerNetworkAdapter instance
 * @param options Configuration options for the router
 * @returns An Express Router ready to be mounted
 *
 * @example
 * ```typescript
 * const adapter = new SseServerNetworkAdapter()
 * const repo = new Repo({ adapters: [adapter, storageAdapter] })
 *
 * app.use("/loro", createSseExpressRouter(adapter, {
 *   syncPath: "/sync",
 *   eventsPath: "/events",
 *   heartbeatInterval: 30000
 * }))
 * ```
 */
export function createSseExpressRouter(
  adapter: SseServerNetworkAdapter,
  options: SseExpressRouterOptions = {},
): Router {
  const {
    syncPath = "/sync",
    eventsPath = "/events",
    heartbeatInterval = 30000,
    getPeerIdFromSyncRequest = req => req.headers["x-peer-id"] as PeerID,
    getPeerIdFromEventsRequest = req => req.query.peerId as PeerID,
  } = options

  const router = express.Router()
  const heartbeats = new Map<PeerID, NodeJS.Timeout>()

  // Binary POST endpoint for clients to send messages TO the server
  // Uses express.raw() to receive binary CBOR with transport-layer prefixes
  router.post(
    syncPath,
    express.raw({ type: "application/octet-stream", limit: "1mb" }),
    (req: Request, res: Response) => {
      // Extract peerId from request
      const peerId = getPeerIdFromSyncRequest(req)

      if (!peerId) {
        res.status(400).json({ error: "Missing peer ID" })
        return
      }

      // Get connection for this peer
      const connection = adapter.getConnection(peerId)

      if (!connection) {
        // Debug: Log all currently connected peers to understand the mismatch
        const allConnections = adapter.getAllConnections()
        const connectedPeerIds = allConnections.map(c => c.peerId)
        adapter.logger.warn(
          "Received message from unknown peer {peerId}. Connected peers: {connectedPeerIds} (count: {count})",
          {
            peerId,
            connectedPeerIds: connectedPeerIds.join(", ") || "(none)",
            count: connectedPeerIds.length,
          },
        )
        res.status(404).json({ error: "Peer not connected" })
        return
      }

      // Ensure we have binary data
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "Expected binary body" })
        return
      }

      // Functional core: parse body through reassembler
      const result = parsePostBody(connection.reassembler, req.body)

      // Imperative shell: execute side effects based on result
      if (result.type === "messages") {
        for (const msg of result.messages) {
          connection.receive(msg)
        }
      } else if (result.type === "error") {
        adapter.logger.warn(
          "Failed to parse message from peer {peerId}: {error}",
          { peerId, error: result.response.body },
        )
      }
      // "pending" type means fragment received, waiting for more - no action needed

      res.status(result.response.status).json(result.response.body)
    },
  )

  // Endpoint for clients to connect and listen for events FROM the server
  // SSE is text-only, so we send JSON
  router.get(eventsPath, (req: Request, res: Response) => {
    const peerId = getPeerIdFromEventsRequest(req)
    if (!peerId) {
      res.status(400).end("peerId is required")
      return
    }

    adapter.logger.info("SSE connection request from peer {peerId}", { peerId })

    // Set headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    res.flushHeaders()
    // Send initial comment to ensure headers are flushed and connection is established
    res.write(": ok\n\n")

    // Register connection with adapter
    const connection = adapter.registerConnection(peerId)
    adapter.logger.info(
      "SSE connection established for peer {peerId}, channelId: {channelId}",
      {
        peerId,
        channelId: connection.channelId,
      },
    )

    // Set up send function to write to SSE stream (JSON for text-only SSE)
    connection.setSendFunction((msg: ChannelMsg) => {
      const serialized = serializeChannelMsg(msg)
      res.write(`data: ${JSON.stringify(serialized)}\n\n`)
      // Flush the response buffer to ensure immediate delivery
      // Note: 'flush' is added by compression middleware or some environments
      if (typeof (res as any).flush === "function") {
        ;(res as any).flush()
      }
    })

    // Set up disconnect handler
    connection.setDisconnectHandler(() => {
      const heartbeat = heartbeats.get(peerId)
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeats.delete(peerId)
      }
      res.end()
    })

    // Setup heartbeat to detect stale connections
    const heartbeat = setInterval(() => {
      try {
        // Send a heartbeat comment (SSE comments are ignored by clients)
        res.write(": heartbeat\n\n")
      } catch (_err) {
        // If we can't write to the response, the connection is dead
        adapter.logger.warn("Heartbeat failed, cleaning up connection", {
          peerId,
        })
        adapter.unregisterConnection(peerId)
        clearInterval(heartbeat)
        heartbeats.delete(peerId)
      }
    }, heartbeatInterval)

    heartbeats.set(peerId, heartbeat)

    // Handle client disconnect
    req.on("close", () => {
      adapter.logger.info(
        "SSE connection closed for peer {peerId} (client disconnect)",
        { peerId },
      )
      adapter.unregisterConnection(peerId)
      const heartbeat = heartbeats.get(peerId)
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeats.delete(peerId)
      }
    })
  })

  return router
}
