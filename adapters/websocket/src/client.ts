/**
 * WebSocket client network adapter.
 *
 * This adapter connects to a WebSocket server and translates between
 * the Loro Syncing Protocol and loro-extended messages.
 */

import {
  Adapter,
  type Channel,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"
import { decodeMessage, encodeMessage } from "./protocol/index.js"
import {
  createTranslationContext,
  fromProtocolMessage,
  type TranslationContext,
  toProtocolMessages,
} from "./protocol/translation.js"
import type { ProtocolMessage } from "./protocol/types.js"

/**
 * Options for the WebSocket client adapter.
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
 * using the Loro Syncing Protocol.
 *
 * @example
 * ```typescript
 * import { WsClientNetworkAdapter } from '@loro-extended/adapter-websocket/client'
 *
 * const adapter = new WsClientNetworkAdapter({
 *   url: 'ws://localhost:3000/ws',
 *   reconnect: { enabled: true },
 * })
 *
 * const repo = new Repo({
 *   peerId: 'client-1',
 *   adapters: [adapter],
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
  private translationContext: TranslationContext
  private options: WsClientOptions
  private WebSocketImpl: typeof globalThis.WebSocket
  private isConnecting = false
  private shouldReconnect = true

  constructor(options: WsClientOptions) {
    super({ adapterType: "websocket-client" })
    this.options = options
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
    this.translationContext = createTranslationContext()
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

        const protocolMsgs = toProtocolMessages(msg, this.translationContext)
        for (const pmsg of protocolMsgs) {
          this.sendProtocolMessage(pmsg)
        }
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

    // Resolve URL
    const url =
      typeof this.options.url === "function"
        ? this.options.url(this.peerId)
        : this.options.url

    this.logger.debug("Connecting to WebSocket server", { url })

    try {
      this.socket = new this.WebSocketImpl(url)
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

      this.logger.info("WebSocket connected", { url })

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

      // Create channel if not exists
      if (this.serverChannel) {
        this.removeChannel(this.serverChannel.channelId)
        this.serverChannel = undefined
      }

      this.serverChannel = this.addChannel()
      this.establishChannel(this.serverChannel.channelId)

      // Simulate handshake completion so Synchronizer starts syncing
      // We use a placeholder peerId for the server
      this.serverChannel.onReceive({
        type: "channel/establish-response",
        identity: {
          peerId: "server" as PeerID,
          name: "server",
          type: "service",
        },
      })
    } catch (error) {
      this.isConnecting = false
      this.logger.error("Failed to connect", { error })
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
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(event: MessageEvent): void {
    const data = event.data

    // Handle text messages (keepalive)
    if (typeof data === "string") {
      // Ignore pong responses
      return
    }

    // Handle binary messages
    if (data instanceof ArrayBuffer) {
      try {
        const msg = decodeMessage(new Uint8Array(data))
        this.handleProtocolMessage(msg)
      } catch (error) {
        this.logger.error("Failed to decode message", { error })
      }
    }
  }

  /**
   * Handle a decoded protocol message.
   */
  private handleProtocolMessage(msg: ProtocolMessage): void {
    if (!this.serverChannel) {
      this.logger.warn("Received message but server channel not available")
      return
    }

    // Pass the server's peerId for ephemeral messages
    const translated = fromProtocolMessage(msg, this.translationContext, {
      senderPeerId: "server",
    })

    if (translated) {
      this.serverChannel.onReceive(translated.channelMsg)
    }
  }

  /**
   * Handle WebSocket close.
   */
  private handleClose(code: number, reason: string): void {
    this.logger.info("WebSocket closed", { code, reason })

    this.stopKeepalive()

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }

    if (this.shouldReconnect) {
      this.scheduleReconnect()
    }
  }

  /**
   * Send a protocol message.
   */
  private sendProtocolMessage(msg: ProtocolMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    const encoded = encodeMessage(msg)
    this.socket.send(encoded)
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

    this.logger.info("Scheduling reconnect", {
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

  /**
   * Get the current connection state.
   */
  get connectionState(): "connecting" | "open" | "closing" | "closed" {
    if (!this.socket) {
      return "closed"
    }

    switch (this.socket.readyState) {
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
  }
}
