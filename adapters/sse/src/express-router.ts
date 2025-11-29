import {
  type ChannelMsg,
  deserializeChannelMsg,
  type PeerID,
  serializeChannelMsg,
} from "@loro-extended/repo"
import type { Request, Response, Router } from "express"
import express from "express"
import type { SseServerNetworkAdapter } from "./server-adapter.js"

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
 * - POST endpoint for clients to send messages to the server
 * - GET endpoint for clients to establish SSE connections
 * - Heartbeat mechanism to detect stale connections
 * - Message serialization/deserialization
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

  // Endpoint for clients to send messages TO the server
  router.post(syncPath, (req: Request, res: Response) => {
    const serialized = req.body
    const message = deserializeChannelMsg(serialized) as ChannelMsg

    // Extract peerId from request
    const peerId = getPeerIdFromSyncRequest(req)

    if (!peerId) {
      res.status(400).send({ error: "Missing peer ID" })
      return
    }

    // Get connection and route message
    const connection = adapter.getConnection(peerId)

    if (connection) {
      connection.receive(message)
      res.status(200).send({ ok: true })
    } else {
      adapter.logger.warn("Received message from unknown peer", { peerId })
      res.status(404).send({ error: "Peer not connected" })
    }
  })

  // Endpoint for clients to connect and listen for events FROM the server
  router.get(eventsPath, (req: Request, res: Response) => {
    const peerId = getPeerIdFromEventsRequest(req)
    if (!peerId) {
      res.status(400).end("peerId is required")
      return
    }

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

    // Set up send function to write to SSE stream
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
