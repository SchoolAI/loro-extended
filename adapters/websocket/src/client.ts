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
import {
  type DisconnectReason,
  type WsClientState,
  WsClientStateMachine,
  type WsClientStateTransition,
} from "./client-state-machine.js"
import { decodeFrame, encodeFrame } from "./wire-format.js"

// Re-export types from state machine for convenience
export type { DisconnectReason, WsClientState, WsClientStateTransition }

/**
 * Legacy connection state type for backward compatibility.
 * @deprecated Use WsClientState instead for full state information
 */
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

  /**
   * Lifecycle event callbacks.
   * These fire at well-defined points in the connection lifecycle.
   */
  lifecycle?: WsClientLifecycleEvents
}

/**
 * Lifecycle event callbacks for the WebSocket client.
 */
export interface WsClientLifecycleEvents {
  /**
   * Called on every state transition.
   * Transitions are delivered asynchronously via microtask queue.
   */
  onStateChange?: (transition: WsClientStateTransition) => void

  /**
   * Called when the connection is lost (intentionally or not).
   * Includes the reason for disconnection.
   */
  onDisconnect?: (reason: DisconnectReason) => void

  /**
   * Called when a reconnection attempt is scheduled.
   * @param attempt The attempt number (1-based)
   * @param nextAttemptMs Milliseconds until the next attempt
   */
  onReconnecting?: (attempt: number, nextAttemptMs: number) => void

  /**
   * Called when reconnection succeeds (socket opens after being disconnected).
   */
  onReconnected?: () => void

  /**
   * Called when the server sends the "ready" signal.
   * At this point, the connection is fully established and ready for use.
   */
  onReady?: () => void
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
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private options: ServiceWsClientOptions
  private WebSocketImpl: typeof globalThis.WebSocket
  private shouldReconnect = true
  private wasConnectedBefore = false

  // Unified state machine
  private readonly stateMachine = new WsClientStateMachine()

  constructor(options: ServiceWsClientOptions) {
    super({ adapterType: "websocket-client" })
    this.options = options
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket

    // Set up lifecycle event forwarding
    this.setupLifecycleEvents()
  }

  /**
   * Set up lifecycle event forwarding from state machine to options callbacks.
   */
  private setupLifecycleEvents(): void {
    this.stateMachine.subscribeToTransitions(transition => {
      // Forward to onStateChange callback
      this.options.lifecycle?.onStateChange?.(transition)

      // Fire specific lifecycle events based on transition
      const { from, to } = transition

      // onDisconnect: when transitioning TO disconnected
      if (to.status === "disconnected" && to.reason) {
        this.options.lifecycle?.onDisconnect?.(to.reason)
      }

      // onReconnecting: when transitioning TO reconnecting
      if (to.status === "reconnecting") {
        this.options.lifecycle?.onReconnecting?.(to.attempt, to.nextAttemptMs)
      }

      // onReconnected: when transitioning from reconnecting/connecting TO connected/ready
      // (only if we were connected before)
      if (
        this.wasConnectedBefore &&
        (from.status === "reconnecting" || from.status === "connecting") &&
        (to.status === "connected" || to.status === "ready")
      ) {
        this.options.lifecycle?.onReconnected?.()
      }

      // onReady: when transitioning TO ready
      if (to.status === "ready") {
        this.options.lifecycle?.onReady?.()
      }
    })
  }

  /**
   * Get the current state of the connection.
   * This is the new, preferred API for checking connection state.
   */
  getState(): WsClientState {
    return this.stateMachine.getState()
  }

  /**
   * Subscribe to state transitions.
   * This is the new, preferred API for observing state changes.
   *
   * @param listener Callback that receives transition events
   * @returns Unsubscribe function
   */
  subscribeToTransitions(
    listener: (transition: WsClientStateTransition) => void,
  ): () => void {
    return this.stateMachine.subscribeToTransitions(listener)
  }

  /**
   * Wait for a specific state.
   *
   * @param predicate Function that returns true when the desired state is reached
   * @param options Options including timeout
   * @returns Promise that resolves with the matching state
   */
  waitForState(
    predicate: (state: WsClientState) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<WsClientState> {
    return this.stateMachine.waitForState(predicate, options)
  }

  /**
   * Wait for a specific status.
   *
   * @param status The status to wait for
   * @param options Options including timeout
   * @returns Promise that resolves with the matching state
   */
  waitForStatus(
    status: WsClientState["status"],
    options?: { timeoutMs?: number },
  ): Promise<WsClientState> {
    return this.stateMachine.waitForStatus(status, options)
  }

  // ============================================================================
  // Backward Compatibility APIs
  // ============================================================================

  /**
   * Subscribe to connection state changes.
   * @deprecated Use subscribeToTransitions() instead for full state information
   * @param listener Callback function that receives the new state
   * @returns Unsubscribe function
   */
  public subscribe(listener: (state: ConnectionState) => void): () => void {
    return this.stateMachine.subscribe(listener)
  }

  /**
   * Get the current connection state (legacy API).
   * @deprecated Use getState() instead for full state information
   */
  get connectionState(): ConnectionState {
    return this.stateMachine.getLegacyConnectionState()
  }

  /**
   * Check if the client is connected (socket is open).
   * Note: This only checks if the socket is open, not if the server is ready.
   * Use `isReady` to check if the connection is fully established.
   */
  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /**
   * Check if the client is ready (server ready signal received).
   * This is the preferred way to check if the connection is fully established.
   */
  get isReady(): boolean {
    return this.stateMachine.isReady()
  }

  /**
   * Check if the server is ready (legacy API).
   * @deprecated Use isReady instead
   */
  get serverReady(): boolean {
    return this.stateMachine.isReady()
  }

  // ============================================================================
  // Adapter Implementation
  // ============================================================================

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
        // Note: We don't call disconnect() here because the channel's stop()
        // is called when the channel is removed, which can happen during
        // handleClose(). If we called disconnect() here, it would transition
        // to disconnected before scheduleReconnect() has a chance to run.
        // The actual disconnect is handled by onStop() or handleClose().
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
    this.wasConnectedBefore = false
    await this.connect()
  }

  async onStop(): Promise<void> {
    this.shouldReconnect = false
    this.disconnect({ type: "intentional" })
  }

  /**
   * Connect to the WebSocket server.
   */
  private async connect(): Promise<void> {
    const currentState = this.stateMachine.getState()
    if (currentState.status === "connecting") {
      return
    }

    if (!this.peerId) {
      throw new Error("Cannot connect: peerId not set")
    }

    // Determine attempt number
    const attempt =
      currentState.status === "reconnecting" ? currentState.attempt : 1

    this.stateMachine.transition({ status: "connecting", attempt })

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
      if (
        this.options.headers &&
        Object.keys(this.options.headers).length > 0
      ) {
        // Use Bun's extended WebSocket constructor with headers
        // Type assertion via unknown needed because Bun extends the standard WebSocket API
        // with a non-standard constructor signature
        type BunWebSocketConstructor = new (
          url: string,
          options: { headers: Record<string, string> },
        ) => WebSocket
        const BunWebSocket = this
          .WebSocketImpl as unknown as BunWebSocketConstructor
        this.socket = new BunWebSocket(url, {
          headers: this.options.headers,
        })
      } else {
        this.socket = new this.WebSocketImpl(url)
      }
      this.socket.binaryType = "arraybuffer"

      // IMPORTANT: Set up message handler IMMEDIATELY after creating the socket.
      // This must happen BEFORE waiting for the open event to avoid a race
      // condition where the server sends "ready" before the handler is attached.
      // The server sends "ready" as soon as the connection opens, and if we wait
      // until after the Promise resolves to set up handlers, we may miss it.
      this.socket.addEventListener("message", event => {
        this.handleMessage(event)
      })

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

      // Socket is now open - transition to connected
      this.stateMachine.transition({ status: "connected" })

      this.logger.info("WebSocket connected to {url} (peerId: {peerId})", {
        url,
        peerId: this.peerId,
      })

      // Set up close handler for disconnections after connection is established
      this.socket.addEventListener("close", event => {
        this.handleClose(event.code, event.reason)
      })

      // Set up error handler for errors after connection is established
      this.socket.addEventListener("error", () => {
        this.logger.warn("WebSocket error")
      })

      // Start keepalive
      this.startKeepalive()

      // Note: Channel creation is deferred until we receive the "ready" signal
      // from the server. This ensures the server is fully set up before we
      // start sending messages.
    } catch (error) {
      this.logger.error(
        "WebSocket connection failed to {url} (peerId: {peerId}): {error}",
        { error, url, peerId: this.peerId },
      )

      // Transition to reconnecting or disconnected
      this.scheduleReconnect({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  private disconnect(reason: DisconnectReason): void {
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

    // Only transition if not already disconnected
    const currentState = this.stateMachine.getState()
    if (currentState.status !== "disconnected") {
      this.stateMachine.transition({ status: "disconnected", reason })
    }
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
    const currentState = this.stateMachine.getState()
    if (currentState.status === "ready") {
      // Already received ready signal, ignore duplicate
      return
    }

    // Transition to ready state
    this.stateMachine.transition({ status: "ready" })
    this.wasConnectedBefore = true

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

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }

    // Schedule reconnect or transition to disconnected
    this.scheduleReconnect({ type: "closed", code, reason })
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
   * Schedule a reconnection attempt or transition to disconnected.
   */
  private scheduleReconnect(reason: DisconnectReason): void {
    const currentState = this.stateMachine.getState()

    // If already disconnected, don't transition again
    if (currentState.status === "disconnected") {
      return
    }

    const reconnectOpts = {
      ...DEFAULT_RECONNECT,
      ...this.options.reconnect,
    }

    if (!this.shouldReconnect || !reconnectOpts.enabled) {
      this.stateMachine.transition({ status: "disconnected", reason })
      return
    }

    // Get current attempt count from state
    const currentAttempt =
      currentState.status === "reconnecting"
        ? currentState.attempt
        : currentState.status === "connecting"
          ? (currentState as { attempt: number }).attempt
          : 0

    if (currentAttempt >= reconnectOpts.maxAttempts) {
      this.logger.error("Max reconnection attempts reached")
      this.stateMachine.transition({
        status: "disconnected",
        reason: { type: "max-retries-exceeded", attempts: currentAttempt },
      })
      return
    }

    const nextAttempt = currentAttempt + 1

    // Exponential backoff with jitter
    const delay = Math.min(
      reconnectOpts.baseDelay * 2 ** (nextAttempt - 1) + Math.random() * 1000,
      reconnectOpts.maxDelay,
    )

    this.stateMachine.transition({
      status: "reconnecting",
      attempt: nextAttempt,
      nextAttemptMs: delay,
    })

    this.logger.info("Scheduling reconnect attempt {attempt} in {delay}ms", {
      attempt: nextAttempt,
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
export function createWsClient(
  options: WsClientOptions,
): WsClientNetworkAdapter {
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
