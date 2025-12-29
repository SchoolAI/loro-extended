/**
 * WebSocket handler interface types.
 *
 * These types define a framework-agnostic interface for WebSocket connections,
 * allowing the adapter to work with any WebSocket library (ws, Hono, etc.).
 */

import type { PeerID } from "@loro-extended/repo"

/**
 * WebSocket ready states.
 */
export type WsReadyState = "connecting" | "open" | "closing" | "closed"

/**
 * Interface that framework-specific WebSocket implementations must satisfy.
 * This allows the adapter to work with any WebSocket library.
 */
export interface WsSocket {
  /** Send binary data through the WebSocket */
  send(data: Uint8Array | string): void

  /** Close the WebSocket connection */
  close(code?: number, reason?: string): void

  /** Register a handler for incoming binary messages */
  onMessage(handler: (data: Uint8Array | string) => void): void

  /** Register a handler for connection close */
  onClose(handler: (code: number, reason: string) => void): void

  /** Register a handler for errors */
  onError(handler: (error: Error) => void): void

  /** The current ready state of the WebSocket */
  readonly readyState: WsReadyState
}

/**
 * Options for handling a new WebSocket connection on the server.
 */
export interface WsConnectionOptions {
  /** The WebSocket instance (framework-specific, wrapped in WsSocket interface) */
  socket: WsSocket

  /** Optional: Extract peer ID from the upgrade request */
  peerId?: PeerID

  /** Optional: Authentication token from the upgrade request */
  authToken?: string
}

/**
 * Forward declaration for WsConnection (defined in connection.ts).
 */
export interface WsConnectionHandle {
  /** The peer ID for this connection */
  readonly peerId: PeerID

  /** The channel ID for this connection */
  readonly channelId: number

  /** Close the connection */
  close(code?: number, reason?: string): void

  /** Check if a room (docId) is joined */
  isRoomJoined(roomId: string): boolean

  /** Get all joined rooms */
  getJoinedRooms(): string[]
}

/**
 * Result of handling a WebSocket connection.
 */
export interface WsConnectionResult {
  /** The connection object for managing this peer */
  connection: WsConnectionHandle

  /** Call this to start processing messages */
  start(): void
}

/**
 * Wrapper function type for creating a WsSocket from a native WebSocket.
 */
export type WsSocketWrapper<T> = (nativeSocket: T) => WsSocket

/**
 * Create a WsSocket wrapper for the standard WebSocket API (browser/Node.js ws).
 */
export function wrapStandardWebSocket(ws: WebSocket): WsSocket {
  return {
    send(data: Uint8Array | string): void {
      ws.send(data)
    },

    close(code?: number, reason?: string): void {
      ws.close(code, reason)
    },

    onMessage(handler: (data: Uint8Array | string) => void): void {
      ws.addEventListener("message", event => {
        if (event.data instanceof ArrayBuffer) {
          handler(new Uint8Array(event.data))
        } else if (event.data instanceof Blob) {
          // Handle Blob data (browser)
          event.data.arrayBuffer().then(buffer => {
            handler(new Uint8Array(buffer))
          })
        } else {
          handler(event.data as string)
        }
      })
    },

    onClose(handler: (code: number, reason: string) => void): void {
      ws.addEventListener("close", event => {
        handler(event.code, event.reason)
      })
    },

    onError(handler: (error: Error) => void): void {
      ws.addEventListener("error", _event => {
        handler(new Error("WebSocket error"))
      })
    },

    get readyState(): WsReadyState {
      switch (ws.readyState) {
        case WebSocket.CONNECTING:
          return "connecting"
        case WebSocket.OPEN:
          return "open"
        case WebSocket.CLOSING:
          return "closing"
        case WebSocket.CLOSED:
          return "closed"
        default:
          return "closed"
      }
    },
  }
}
