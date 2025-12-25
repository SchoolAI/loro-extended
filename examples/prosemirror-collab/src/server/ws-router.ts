/**
 * WebSocket router for loro-extended synchronization.
 *
 * Integrates the WsServerNetworkAdapter with Fastify's WebSocket support
 * for real-time document synchronization.
 */

import { wrapWsSocket } from "@loro-extended/adapter-websocket/server"
import type { PeerID } from "@loro-extended/repo"
import type { FastifyInstance } from "fastify"
import { wsAdapter } from "./repo.js"

export interface WsRouterOptions {
  /**
   * Path for the WebSocket endpoint.
   * @default "/ws"
   */
  path?: string
}

/**
 * Register WebSocket routes for loro-extended synchronization.
 *
 * @param fastify The Fastify instance (must have @fastify/websocket registered)
 * @param options Configuration options for the router
 *
 * @example
 * ```typescript
 * await app.register(fastifyWebsocket)
 * await registerWsRoutes(app, { path: '/ws' })
 * ```
 */
export async function registerWsRoutes(
  fastify: FastifyInstance,
  options: WsRouterOptions = {},
): Promise<void> {
  const { path = "/ws" } = options

  fastify.get(path, { websocket: true }, (socket, req) => {
    // Extract peer ID from query string
    const url = new URL(req.url, `http://${req.headers.host}`)
    const peerId = url.searchParams.get("peerId") as PeerID | null

    fastify.log.info({ peerId, url: req.url }, "WebSocket connection attempt")

    // Handle the connection with the WebSocket adapter
    const { connection, start } = wsAdapter.handleConnection({
      socket: wrapWsSocket(socket),
      peerId: peerId || undefined,
    })

    fastify.log.info(
      { peerId: connection.peerId, channelId: connection.channelId },
      "WebSocket client connected",
    )

    // Start processing messages
    start()
  })

  fastify.log.info({ path }, "WebSocket routes registered")
}
