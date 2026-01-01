/**
 * WebSocket server network adapter for native loro-extended protocol.
 *
 * This adapter manages WebSocket connections from clients, directly
 * transmitting ChannelMsg types without protocol translation.
 */

import {
  Adapter,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"
import { WsConnection } from "./connection.js"
import type {
  WsConnectionOptions,
  WsConnectionResult,
  WsSocket,
} from "./handler/types.js"

/**
 * Generate a random peer ID for connections that don't provide one.
 */
function generatePeerId(): PeerID {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let result = "ws-"
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result as PeerID
}

/**
 * WebSocket server network adapter.
 *
 * This adapter is framework-agnostic and works with any WebSocket library
 * through the WsSocket interface. Use the handleConnection() method to
 * integrate with your framework's WebSocket upgrade handler.
 *
 * @example Express with ws:
 * ```typescript
 * import { WebSocketServer } from 'ws'
 * import { WsServerNetworkAdapter, wrapWsSocket } from '@loro-extended/adapter-websocket/server'
 *
 * const wss = new WebSocketServer({ server })
 * const adapter = new WsServerNetworkAdapter()
 *
 * wss.on('connection', (ws, req) => {
 *   const { connection, start } = adapter.handleConnection({
 *     socket: wrapWsSocket(ws),
 *     peerId: req.query.peerId,
 *   })
 *   start()
 * })
 * ```
 */
export class WsServerNetworkAdapter extends Adapter<PeerID> {
  private connections = new Map<PeerID, WsConnection>()

  constructor() {
    super({ adapterType: "websocket-server" })
  }

  protected generate(peerId: PeerID): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: (msg: ChannelMsg) => {
        const connection = this.connections.get(peerId)
        if (connection) {
          connection.send(msg)
        } else {
          this.logger.warn("Tried to send to disconnected peer", { peerId })
        }
      },
      stop: () => {
        this.unregisterConnection(peerId)
      },
    }
  }

  async onStart(): Promise<void> {
    this.logger.info("WebSocket server adapter started")
  }

  async onStop(): Promise<void> {
    // Disconnect all active connections
    for (const connection of this.connections.values()) {
      connection.close(1001, "Server shutting down")
    }
    this.connections.clear()
    this.logger.info("WebSocket server adapter stopped")
  }

  /**
   * Handle a new WebSocket connection.
   * Call this from your framework's WebSocket upgrade handler.
   *
   * @param options Connection options including the WebSocket and optional peer ID
   * @returns A connection handle and start function
   */
  handleConnection(options: WsConnectionOptions): WsConnectionResult {
    const { socket, peerId: providedPeerId } = options

    // Generate peer ID if not provided
    const peerId = providedPeerId ?? generatePeerId()

    // Check for existing connection with same peer ID
    const existingConnection = this.connections.get(peerId)
    if (existingConnection) {
      this.logger.warn("Replacing existing connection for peer", { peerId })
      existingConnection.close(1000, "Replaced by new connection")
      this.unregisterConnection(peerId)
    }

    // Create channel for this peer
    const channel = this.addChannel(peerId)

    // Create connection object
    const connection = new WsConnection(peerId, channel.channelId, socket)
    connection._setChannel(channel)

    // Store connection
    this.connections.set(peerId, connection)

    // Set up close handler
    socket.onClose((_code, _reason) => {
      this.unregisterConnection(peerId)
    })

    socket.onError(_error => {
      this.unregisterConnection(peerId)
    })

    this.logger.info("Client connected", {
      peerId,
      channelId: channel.channelId,
      totalClients: this.connections.size,
    })

    return {
      connection,
      start: () => {
        connection.start()
        // Trigger establishment handshake
        this.establishChannel(channel.channelId)

        // Simulate handshake completion so Synchronizer starts syncing
        connection.simulateHandshake(peerId)

        // Send ready signal to client so it knows the server is ready
        connection.sendReady()
      },
    }
  }

  /**
   * Get an active connection by peer ID.
   */
  getConnection(peerId: PeerID): WsConnection | undefined {
    return this.connections.get(peerId)
  }

  /**
   * Get all active connections.
   */
  getAllConnections(): WsConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Check if a peer is connected.
   */
  isConnected(peerId: PeerID): boolean {
    return this.connections.has(peerId)
  }

  /**
   * Manually unregister a connection.
   */
  unregisterConnection(peerId: PeerID): void {
    const connection = this.connections.get(peerId)
    if (connection) {
      this.removeChannel(connection.channelId)
      this.connections.delete(peerId)

      this.logger.info("Client disconnected", {
        peerId,
        totalClients: this.connections.size,
      })
    }
  }

  /**
   * Broadcast a message to all connected peers.
   */
  broadcast(msg: ChannelMsg): void {
    for (const connection of this.connections.values()) {
      connection.send(msg)
    }
  }

  /**
   * Get the number of connected peers.
   */
  get connectionCount(): number {
    return this.connections.size
  }
}

/**
 * Create a WsSocket wrapper for the 'ws' library (Node.js).
 */
export function wrapWsSocket(ws: {
  send(data: Uint8Array | string): void
  close(code?: number, reason?: string): void
  on(
    event: "message",
    handler: (data: Buffer | ArrayBuffer | string, isBinary: boolean) => void,
  ): void
  on(event: "close", handler: (code: number, reason: Buffer) => void): void
  on(event: "error", handler: (error: Error) => void): void
  readyState: number
}): WsSocket {
  const CONNECTING = 0
  const OPEN = 1
  const CLOSING = 2

  return {
    send(data: Uint8Array | string): void {
      ws.send(data)
    },

    close(code?: number, reason?: string): void {
      ws.close(code, reason)
    },

    onMessage(handler: (data: Uint8Array | string) => void): void {
      ws.on(
        "message",
        (data: Buffer | ArrayBuffer | string, isBinary: boolean) => {
          if (isBinary) {
            // Binary message - convert to Uint8Array
            if (Buffer.isBuffer(data)) {
              handler(new Uint8Array(data))
            } else if (data instanceof ArrayBuffer) {
              handler(new Uint8Array(data))
            } else {
              handler(new Uint8Array(data as unknown as ArrayBuffer))
            }
          } else {
            // Text message - convert to string
            if (Buffer.isBuffer(data)) {
              handler(data.toString("utf-8"))
            } else {
              handler(data as string)
            }
          }
        },
      )
    },

    onClose(handler: (code: number, reason: string) => void): void {
      ws.on("close", (code, reason) => {
        handler(code, reason.toString())
      })
    },

    onError(handler: (error: Error) => void): void {
      ws.on("error", handler)
    },

    get readyState() {
      switch (ws.readyState) {
        case CONNECTING:
          return "connecting" as const
        case OPEN:
          return "open" as const
        case CLOSING:
          return "closing" as const
        default:
          return "closed" as const
      }
    },
  }
}
