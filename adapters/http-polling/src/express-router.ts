import type { PeerID } from "@loro-extended/repo"
import { serializeChannelMsg } from "@loro-extended/repo"
import type { Request, Response, Router } from "express"
import express from "express"
import { parsePostBody } from "./polling-handler.js"
import type { HttpPollingServerNetworkAdapter } from "./server-adapter.js"

export interface HttpPollingExpressRouterOptions {
  /**
   * Path for the poll endpoint where clients GET messages.
   * @default "/poll"
   */
  pollPath?: string

  /**
   * Path for the sync endpoint where clients POST messages.
   * @default "/sync"
   */
  syncPath?: string

  /**
   * Maximum time server will hold a long-poll request (caps client's serverWaitHint).
   * @default 60000 (60 seconds)
   */
  maxServerWait?: number

  /**
   * Custom function to extract peerId from the poll request.
   * By default, reads from the "peerId" query parameter.
   */
  getPeerIdFromPollRequest?: (req: Request) => PeerID | undefined

  /**
   * Custom function to extract peerId from the sync request.
   * By default, reads from the "x-peer-id" header.
   */
  getPeerIdFromSyncRequest?: (req: Request) => PeerID | undefined
}

/**
 * Create an Express router for HTTP polling server adapter.
 *
 * This factory function creates Express routes that integrate with the
 * HttpPollingServerNetworkAdapter. It handles:
 * - GET endpoint for clients to poll for messages (with long-polling support)
 * - POST endpoint for clients to send binary CBOR messages to the server
 * - DELETE endpoint for clients to explicitly disconnect
 * - Message serialization/deserialization
 *
 * ## Wire Format
 *
 * The POST endpoint accepts binary CBOR with transport-layer prefixes:
 * - `Content-Type: application/octet-stream`
 * - Body contains MESSAGE_COMPLETE (0x00) or FRAGMENT_HEADER/DATA (0x01/0x02) prefixed data
 *
 * The GET endpoint returns JSON messages (simpler client handling, no size limits on response).
 *
 * @param adapter The HttpPollingServerNetworkAdapter instance
 * @param options Configuration options for the router
 * @returns An Express Router ready to be mounted
 *
 * @example
 * ```typescript
 * const adapter = new HttpPollingServerNetworkAdapter()
 * const repo = new Repo({ adapters: [adapter, storageAdapter] })
 *
 * app.use("/loro", createHttpPollingExpressRouter(adapter, {
 *   pollPath: "/poll",
 *   syncPath: "/sync",
 *   maxServerWait: 60000
 * }))
 * ```
 */
export function createHttpPollingExpressRouter(
  adapter: HttpPollingServerNetworkAdapter,
  options: HttpPollingExpressRouterOptions = {},
): Router {
  const {
    pollPath = "/poll",
    syncPath = "/sync",
    maxServerWait = 60000,
    getPeerIdFromPollRequest = req => req.query.peerId as PeerID | undefined,
    getPeerIdFromSyncRequest = req =>
      req.headers["x-peer-id"] as PeerID | undefined,
  } = options

  const router = express.Router()

  // GET endpoint for clients to poll for messages (JSON response)
  router.get(pollPath, async (req: Request, res: Response) => {
    const peerId = getPeerIdFromPollRequest(req)

    if (!peerId) {
      res.status(400).json({ error: "peerId is required" })
      return
    }

    // Parse wait parameter (how long client wants server to wait)
    const waitParam = req.query.wait
    let waitMs = 0
    if (typeof waitParam === "string") {
      waitMs = Math.min(Number.parseInt(waitParam, 10) || 0, maxServerWait)
    }

    // Get or create connection
    let connection = adapter.getConnection(peerId)
    const isNewConnection = !connection

    if (!connection) {
      connection = adapter.registerConnection(peerId)
    }

    try {
      // Wait for messages (or return immediately if waitMs is 0 or messages are queued)
      const messages = await connection.waitForMessages(waitMs)

      // Serialize messages for transport (JSON for GET responses)
      const serializedMessages = messages.map(msg => serializeChannelMsg(msg))

      res.json({
        messages: serializedMessages,
        isNewConnection,
      })
    } catch (error) {
      adapter.logger.error("Error during poll", { peerId, error })
      res.status(500).json({ error: "Internal server error" })
    }
  })

  // Binary POST endpoint for clients to send messages TO the server
  // Uses express.raw() to receive binary CBOR with transport-layer prefixes
  router.post(
    syncPath,
    express.raw({ type: "application/octet-stream", limit: "1mb" }),
    (req: Request, res: Response) => {
      const peerId = getPeerIdFromSyncRequest(req)

      if (!peerId) {
        res.status(400).json({ error: "x-peer-id header is required" })
        return
      }

      // Get connection
      const connection = adapter.getConnection(peerId)

      if (!connection) {
        res.status(404).json({
          error: "Connection not found. Poll first to establish connection.",
        })
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

  // DELETE endpoint for clients to explicitly disconnect
  router.delete(pollPath, (req: Request, res: Response) => {
    const peerId = getPeerIdFromPollRequest(req)

    if (!peerId) {
      res.status(400).json({ error: "peerId is required" })
      return
    }

    adapter.unregisterConnection(peerId)
    res.json({ ok: true })
  })

  return router
}
