/**
 * WebSocket client network adapter for native loro-extended protocol.
 *
 * This adapter connects to a WebSocket server and directly transmits
 * ChannelMsg types without protocol translation.
 */

import {
  Adapter,
  type Channel,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"
import { decodeFrame, encodeFrame } from "./wire-format.js"

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

/**
 * Base options for the WebSocket client adapter.
 * Used for browser-to-server connections.
 */
export interface WsClientOptions {
  /** WebSocket URL to connect to */
  url: string | ((peerId: PeerID) => string)

  /** Optional: Custom WebSocket implementation (for Node.js) */
  WebSocket?: typeof globalThis.WebSocket

  /** Reconnection options */
  reconnect?: {
    enabled: boolean
    maxAttempts?: number
    baseDelay?: number
    maxDelay?: number
  }

  /** Keepalive interval in ms (default: 30000) */
  keepaliveInterval?: number
}

/**
 * Options for service-to-service WebSocket connections.
 * Extends WsClientOptions with header support for authentication.
 *
 * Note: Headers are a Bun/Node-specific extension. The browser WebSocket API
 * does not support custom headers per the WHATWG spec.
 */
export interface ServiceWsClientOptions extends WsClientOptions {
  /**
   * Headers to send during WebSocket upgrade.
   * Used for authentication in service-to-service communication.
   *
   * @example
   * ```typescript
   * headers: {
   *   "Authorization": "Bearer my-token",
   *   "X-Internal-Secret": "shared-secret"
   * }
   * ```
   */
  headers?: Record<string, string>
}

/**
 * Default reconnection options.
 */
const DEFAULT_RECONNECT = {
  enabled: true,
  maxAttempts: 10,
  baseDelay: 1000,
  maxDelay: 30000,
}

/**
 * WebSocket client network adapter.
 *
 * Connects to a WebSocket server and handles bidirectional communication
 * using the native loro-extended wire protocol.
 *
 * @deprecated Use the factory functions instead of instantiating directly:
 * - `createWsClient()` - For browser-to-server connections
 * - `createServiceWsClient()` - For service-to-service connections (supports headers)
 *
 * @example Browser client
 * ```typescript
 * import { createWsClient } from '@loro-extended/adapter-websocket/client'
 *
 * const adapter = createWsClient({
 *   url: 'ws://localhost:3000/ws',
 *   reconnect: { enabled: true },
 * })
 * ```
 *
 * @example Service-to-service client
 * ```typescript
 * import { createServiceWsClient } from '@loro-extended/adapter-websocket/client'
 *
 * const adapter = createServiceWsClient({
 *   url: 'ws://localhost:3000/ws',
 *   headers: { 'Authorization': 'Bearer token' },
 * })
 * ```
 */
export class WsClientNetworkAdapter extends Adapter<void> {
  private peerId?: PeerID
  private socket?: WebSocket
  private serverChannel?: Channel
  private keepaliveTimer?: ReturnType<typeof setInterval>
  private reconnectAttempts = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private options: ServiceWsClientOptions
  private WebSocketImpl: typeof globalThis.WebSocket
  private isConnecting = false
  private shouldReconnect = true
  private serverReady = false
  public connectionState: ConnectionState = "disconnected"
  private listeners = new Set<(state: ConnectionState) => void>()

  constructor(options: ServiceWsClientOptions) {
    super({ adapterType: "websocket-client" })
    this.options = options
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
  }

  /**
   * Subscribe to connection state changes.
   * @param listener Callback function that receives the new state
   * @returns Unsubscribe function
   */
  public subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    // Emit current state immediately
    listener(this.connectionState)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state
      for (const listener of this.listeners) {
        listener(state)
      }
    }
  }

  protected generate(): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: (msg: ChannelMsg) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          this.logger.warn("Cannot send: WebSocket not connected")
          return
        }

        const frame = encodeFrame(msg)
        this.socket.send(frame)
      },
      stop: () => {
        this.disconnect()
      },
    }
  }

  async onStart(): Promise<void> {
    if (!this.identity) {
      throw new Error(
        "Adapter not properly initialized - identity not available",
      )
    }
    this.peerId = this.identity.peerId
    this.shouldReconnect = true
    await this.connect()
  }

  async onStop(): Promise<void> {
    this.shouldReconnect = false
    this.disconnect()
  }

  /**
   * Connect to the WebSocket server.
   */
  private async connect(): Promise<void> {
    if (this.isConnecting) {
      return
    }

    if (!this.peerId) {
      throw new Error("Cannot connect: peerId not set")
    }

    this.isConnecting = true
    this.setConnectionState("connecting")

    // Resolve URL
    const url =
      typeof this.options.url === "function"
        ? this.options.url(this.peerId)
        : this.options.url

    this.logger.info("WebSocket connecting to {url} (peerId: {peerId})", {
      url,
      peerId: this.peerId,
    })

    try {
      // Create WebSocket with optional headers (Bun-specific extension)
      // The browser WebSocket API doesn't support headers, but Bun does
      if (this.options.headers && Object.keys(this.options.headers).length > 0) {
        // Use Bun's extended WebSocket constructor with headers
        // Type assertion via unknown needed because Bun extends the standard WebSocket API
        // with a non-standard constructor signature
        type BunWebSocketConstructor = new (
          url: string,
          options: { headers: Record<string, string> },
        ) => WebSocket
        const BunWebSocket = this.WebSocketImpl as unknown as BunWebSocketConstructor
        this.socket = new BunWebSocket(url, {
          headers: this.options.headers,
        })
      } else {
        this.socket = new this.WebSocketImpl(url)
      }
      this.socket.binaryType = "arraybuffer"

      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error("Socket not created"))
          return
        }

        const onOpen = () => {
          cleanup()
          resolve()
        }

        const onError = (event: Event) => {
          cleanup()
          reject(new Error(`WebSocket connection failed: ${event}`))
        }

        const onClose = () => {
          cleanup()
          reject(new Error("WebSocket closed during connection"))
        }

        const cleanup = () => {
          this.socket?.removeEventListener("open", onOpen)
          this.socket?.removeEventListener("error", onError)
          this.socket?.removeEventListener("close", onClose)
        }

        this.socket.addEventListener("open", onOpen)
        this.socket.addEventListener("error", onError)
        this.socket.addEventListener("close", onClose)
      })

      this.isConnecting = false
      this.reconnectAttempts = 0
      this.setConnectionState("connected")

      this.logger.info("WebSocket connected to {url} (peerId: {peerId})", {
        url,
        peerId: this.peerId,
      })

      // Set up message handler
      this.socket.addEventListener("message", event => {
        this.handleMessage(event)
      })

      // Set up close handler
      this.socket.addEventListener("close", event => {
        this.handleClose(event.code, event.reason)
      })

      // Set up error handler
      this.socket.addEventListener("error", () => {
        this.logger.warn("WebSocket error")
      })

      // Start keepalive
      this.startKeepalive()

      // Reset server ready flag - we'll wait for the "ready" signal
      this.serverReady = false

      // Note: Channel creation is deferred until we receive the "ready" signal
      // from the server. This ensures the server is fully set up before we
      // start sending messages.
    } catch (error) {
      this.isConnecting = false
      this.logger.error(
        "WebSocket connection failed to {url} (peerId: {peerId}): {error}",
        { error, url, peerId: this.peerId },
      )
      this.setConnectionState("disconnected")
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  private disconnect(): void {
    this.stopKeepalive()
    this.clearReconnectTimer()

    if (this.socket) {
      this.socket.close(1000, "Client disconnecting")
      this.socket = undefined
    }

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }
    this.serverReady = false
    this.setConnectionState("disconnected")
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(event: MessageEvent): void {
    const data = event.data

    // Handle text messages (keepalive and ready signal)
    if (typeof data === "string") {
      if (data === "ready") {
        this.handleServerReady()
      }
      // Ignore pong responses
      return
    }

    // Handle binary messages
    if (data instanceof ArrayBuffer) {
      try {
        const messages = decodeFrame(new Uint8Array(data))
        for (const msg of messages) {
          this.handleChannelMessage(msg)
        }
      } catch (error) {
        this.logger.error("Failed to decode message", { error })
      }
    }
  }

  /**
   * Handle the "ready" signal from the server.
   * This creates the channel and starts the establishment handshake.
   *
   * The "ready" signal is a transport-level indicator that the server's
   * WebSocket handler is ready. After receiving it, we create our channel
   * and send a real establish-request. The server will respond with a real
   * establish-response containing its actual identity.
   */
  private handleServerReady(): void {
    if (this.serverReady) {
      // Already received ready signal, ignore duplicate
      return
    }

    this.serverReady = true
    this.logger.debug("Received ready signal from server")

    // Create channel if not exists
    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }

    this.serverChannel = this.addChannel()

    // Send real establish-request over the wire
    // The server will respond with establish-response containing its actual identity
    // which will be processed by the Synchronizer's handle-establish-response handler
    this.establishChannel(this.serverChannel.channelId)
  }

  /**
   * Handle a decoded channel message.
   *
   * Delivers messages synchronously. The Synchronizer's receive queue handles
   * recursion prevention by queuing messages and processing them iteratively.
   */
  private handleChannelMessage(msg: ChannelMsg): void {
    if (!this.serverChannel) {
      this.logger.warn("Received message but server channel not available")
      return
    }

    // Deliver synchronously - the Synchronizer's receive queue prevents recursion
    this.serverChannel.onReceive(msg)
  }

  /**
   * Handle WebSocket close.
   */
  private handleClose(code: number, reason: string): void {
    this.logger.info(
      "WebSocket disconnected (code: {code}, reason: {reason}, peerId: {peerId})",
      { code, reason, peerId: this.peerId },
    )

    this.stopKeepalive()
    this.serverReady = false

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }

    if (this.shouldReconnect) {
      this.setConnectionState("disconnected")
      this.scheduleReconnect()
    } else {
      this.setConnectionState("disconnected")
    }
  }

  /**
   * Start the keepalive timer.
   */
  private startKeepalive(): void {
    this.stopKeepalive()

    const interval = this.options.keepaliveInterval ?? 30000

    this.keepaliveTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send("ping")
      }
    }, interval)
  }

  /**
   * Stop the keepalive timer.
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = undefined
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    const reconnectOpts = {
      ...DEFAULT_RECONNECT,
      ...this.options.reconnect,
    }

    if (!reconnectOpts.enabled) {
      return
    }

    if (this.reconnectAttempts >= reconnectOpts.maxAttempts) {
      this.logger.error("Max reconnection attempts reached")
      return
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      reconnectOpts.baseDelay * 2 ** this.reconnectAttempts +
        Math.random() * 1000,
      reconnectOpts.maxDelay,
    )

    this.reconnectAttempts++
    this.setConnectionState("reconnecting")

    this.logger.info("Scheduling reconnect attempt {attempt} in {delay}ms", {
      attempt: this.reconnectAttempts,
      delay,
    })

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  /**
   * Clear the reconnect timer.
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  /**
   * Check if the client is connected.
   */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
}

/**
 * Create a WebSocket client adapter for browser-to-server connections.
 *
 * This is the recommended way to create a WebSocket client for browser environments.
 * For service-to-service connections that need header-based authentication,
 * use `createServiceWsClient()` instead.
 *
 * @example
 * ```typescript
 * import { createWsClient } from '@loro-extended/adapter-websocket/client'
 *
 * const adapter = createWsClient({
 *   url: 'ws://localhost:3000/ws',
 *   reconnect: { enabled: true },
 * })
 *
 * const repo = new Repo({
 *   peerId: 'browser-client',
 *   adapters: [adapter],
 * })
 * ```
 */
export function createWsClient(options: WsClientOptions): WsClientNetworkAdapter {
  return new WsClientNetworkAdapter(options)
}

/**
 * Create a WebSocket client adapter for service-to-service connections.
 *
 * This factory function is for backend/server environments (Bun, Node.js)
 * where you need to pass authentication headers during the WebSocket upgrade.
 *
 * **Note:** Headers are a Bun/Node-specific extension. The browser WebSocket API
 * does not support custom headers per the WHATWG spec. For browser clients,
 * use `createWsClient()` and authenticate via URL query parameters or
 * first-message authentication.
 *
 * @example
 * ```typescript
 * import { createServiceWsClient } from '@loro-extended/adapter-websocket/client'
 *
 * const adapter = createServiceWsClient({
 *   url: 'ws://primary-server:3000/ws',
 *   headers: {
 *     'Authorization': 'Bearer internal-service-token',
 *     'X-Internal-Secret': process.env.INTERNAL_SECRET,
 *   },
 *   reconnect: { enabled: true },
 * })
 *
 * const repo = new Repo({
 *   peerId: 'secondary-server',
 *   adapters: [adapter],
 * })
 * ```
 */
export function createServiceWsClient(
  options: ServiceWsClientOptions,
): WsClientNetworkAdapter {
  return new WsClientNetworkAdapter(options)
}
