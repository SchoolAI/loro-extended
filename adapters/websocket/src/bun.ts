/**
 * Bun-specific WebSocket wrapper for @loro-extended/adapter-websocket.
 *
 * This module provides a wrapper to adapt Bun's ServerWebSocket to the
 * WsSocket interface expected by WsServerNetworkAdapter.
 *
 * @packageDocumentation
 */

import type { ServerWebSocket } from "bun"
import type { WsReadyState, WsSocket } from "./handler/types.js"

/**
 * Data structure stored in ws.data for handler callbacks.
 * Use this type when defining your Bun.serve() generic.
 *
 * @example
 * ```typescript
 * Bun.serve<BunWsData>({
 *   websocket: { ... }
 * })
 * ```
 */
export type BunWsData = {
  handlers: {
    onMessage?: (data: Uint8Array | string) => void
    onClose?: (code: number, reason: string) => void
  }
}

/**
 * Wrap Bun's ServerWebSocket to match the WsSocket interface.
 *
 * Bun's WebSocket API is callback-based at the server level, not on individual
 * sockets. This wrapper bridges that gap by storing handlers in ws.data.
 *
 * @example
 * ```typescript
 * import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
 * import { wrapBunWebSocket, type BunWsData } from "@loro-extended/adapter-websocket/bun"
 *
 * const wsAdapter = new WsServerNetworkAdapter()
 *
 * Bun.serve<BunWsData>({
 *   websocket: {
 *     open(ws) {
 *       const socket = wrapBunWebSocket(ws)
 *       wsAdapter.handleConnection({ socket }).start()
 *     },
 *     message(ws, msg) {
 *       const data = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg
 *       ws.data?.handlers?.onMessage?.(data)
 *     },
 *     close(ws, code, reason) {
 *       ws.data?.handlers?.onClose?.(code, reason)
 *     },
 *   },
 * })
 * ```
 */
export function wrapBunWebSocket(ws: ServerWebSocket<BunWsData>): WsSocket {
  ws.data = { handlers: {} }

  return {
    send(data: Uint8Array | string): void {
      ws.send(data)
    },

    close(code?: number, reason?: string): void {
      ws.close(code, reason)
    },

    onMessage(handler: (data: Uint8Array | string) => void): void {
      ws.data.handlers.onMessage = handler
    },

    onClose(handler: (code: number, reason: string) => void): void {
      ws.data.handlers.onClose = handler
    },

    onError(_handler: (error: Error) => void): void {
      // Bun handles errors at the server level, not per-socket
    },

    get readyState(): WsReadyState {
      const states: WsReadyState[] = ["connecting", "open", "closing", "closed"]
      return states[ws.readyState] ?? "closed"
    },
  }
}

/**
 * Create Bun WebSocket handlers that integrate with WsServerNetworkAdapter.
 *
 * This helper eliminates boilerplate by providing pre-configured handlers
 * for open, message, and close events.
 *
 * @example
 * ```typescript
 * import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
 * import { createBunWebSocketHandlers, type BunWsData } from "@loro-extended/adapter-websocket/bun"
 *
 * const wsAdapter = new WsServerNetworkAdapter()
 *
 * Bun.serve<BunWsData>({
 *   fetch(req, server) { ... },
 *   websocket: createBunWebSocketHandlers(wsAdapter),
 * })
 * ```
 */
export function createBunWebSocketHandlers(wsAdapter: {
  handleConnection: (opts: { socket: WsSocket }) => { start: () => void }
}) {
  return {
    open(ws: ServerWebSocket<BunWsData>) {
      wsAdapter.handleConnection({ socket: wrapBunWebSocket(ws) }).start()
    },
    message(
      ws: ServerWebSocket<BunWsData>,
      msg: string | ArrayBuffer | Buffer,
    ) {
      const data =
        msg instanceof ArrayBuffer
          ? new Uint8Array(msg)
          : Buffer.isBuffer(msg)
            ? new Uint8Array(msg)
            : msg
      ws.data.handlers.onMessage?.(data)
    },
    close(ws: ServerWebSocket<BunWsData>, code: number, reason: string) {
      ws.data.handlers.onClose?.(code, reason)
    },
  }
}
