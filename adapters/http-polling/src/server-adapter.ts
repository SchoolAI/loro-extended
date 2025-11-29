import {
  Adapter,
  type Channel,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"

/**
 * Represents an active HTTP polling connection to a peer.
 * This class manages the lifecycle of a single peer connection,
 * including message queuing and long-polling support.
 */
export class HttpPollingConnection {
  private _channel: Channel | null = null
  private _messageQueue: ChannelMsg[] = []
  private _lastActivity: number = Date.now()
  private _waitingResolver: ((messages: ChannelMsg[]) => void) | null = null
  private _waitingTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    public readonly peerId: PeerID,
    public readonly channelId: number,
  ) {}

  /**
   * Internal: Set the channel reference (called by adapter).
   */
  _setChannel(channel: Channel): void {
    this._channel = channel
  }

  /**
   * Get the timestamp of the last activity on this connection.
   */
  get lastActivity(): number {
    return this._lastActivity
  }

  /**
   * Update the last activity timestamp.
   */
  touch(): void {
    this._lastActivity = Date.now()
  }

  /**
   * Enqueue a message to be sent on the next poll.
   * If a poll request is currently waiting (long-polling), resolves it immediately.
   */
  enqueue(msg: ChannelMsg): void {
    this._messageQueue.push(msg)

    // If there's a waiting poll request, resolve it immediately
    if (this._waitingResolver) {
      const messages = this.drain()
      const resolver = this._waitingResolver
      this._waitingResolver = null

      if (this._waitingTimeout) {
        clearTimeout(this._waitingTimeout)
        this._waitingTimeout = null
      }

      resolver(messages)
    }
  }

  /**
   * Drain all queued messages (called on poll).
   * Returns the messages and clears the queue.
   */
  drain(): ChannelMsg[] {
    const messages = this._messageQueue
    this._messageQueue = []
    this.touch()
    return messages
  }

  /**
   * Wait for messages with timeout (for long-polling).
   * Returns immediately if messages are already queued.
   *
   * @param timeoutMs Maximum time to wait for messages (0 = return immediately)
   * @returns Promise that resolves with queued messages
   */
  waitForMessages(timeoutMs: number): Promise<ChannelMsg[]> {
    // If messages are already queued, return immediately
    if (this._messageQueue.length > 0 || timeoutMs <= 0) {
      return Promise.resolve(this.drain())
    }

    // Set up long-polling wait
    return new Promise(resolve => {
      this._waitingResolver = resolve

      this._waitingTimeout = setTimeout(() => {
        // Timeout reached, resolve with whatever we have (likely empty)
        if (this._waitingResolver) {
          const messages = this.drain()
          this._waitingResolver = null
          this._waitingTimeout = null
          resolve(messages)
        }
      }, timeoutMs)
    })
  }

  /**
   * Cancel any waiting poll request.
   * Called when the connection is being cleaned up.
   */
  cancelWait(): void {
    if (this._waitingResolver) {
      const messages = this.drain()
      this._waitingResolver(messages)
      this._waitingResolver = null
    }

    if (this._waitingTimeout) {
      clearTimeout(this._waitingTimeout)
      this._waitingTimeout = null
    }
  }

  /**
   * Receive a message from the client and route it to the channel.
   */
  receive(msg: ChannelMsg): void {
    if (!this._channel) {
      throw new Error(
        `Cannot receive message: channel not set for peer ${this.peerId}`,
      )
    }
    this._channel.onReceive(msg)
  }

  /**
   * Check if this connection has a waiting poll request.
   */
  get isWaiting(): boolean {
    return this._waitingResolver !== null
  }

  /**
   * Get the number of queued messages.
   */
  get queueLength(): number {
    return this._messageQueue.length
  }
}

/**
 * HTTP Polling server network adapter that manages peer connections.
 * This adapter is framework-agnostic and does not depend on Express or any HTTP framework.
 *
 * Use a router factory (like createHttpPollingExpressRouter) to integrate with your HTTP framework.
 */
export class HttpPollingServerNetworkAdapter extends Adapter<PeerID> {
  private connections = new Map<PeerID, HttpPollingConnection>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private _connectionTimeout: number

  constructor(options: { connectionTimeout?: number } = {}) {
    super({ adapterId: "http-polling-server" })
    this._connectionTimeout = options.connectionTimeout ?? 120000 // 2 minutes default
  }

  protected generate(peerId: PeerID): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: (msg: ChannelMsg) => {
        const connection = this.connections.get(peerId)
        if (connection) {
          connection.enqueue(msg)
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
    this.logger.info("HTTP polling server adapter started")

    // Start cleanup interval for stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections()
    }, this._connectionTimeout / 2)
  }

  async onStop(): Promise<void> {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Cancel all waiting requests and clear connections
    for (const connection of this.connections.values()) {
      connection.cancelWait()
    }
    this.connections.clear()

    this.logger.info("HTTP polling server adapter stopped")
  }

  /**
   * Register a new peer connection.
   * This should be called when a peer first polls.
   *
   * @param peerId The unique identifier for the peer
   * @returns An HttpPollingConnection object that can be used to manage the connection
   */
  registerConnection(peerId: PeerID): HttpPollingConnection {
    // Check if connection already exists
    const existing = this.connections.get(peerId)
    if (existing) {
      existing.touch()
      return existing
    }

    // Create channel for this peer
    const channel = this.addChannel(peerId)

    // Create connection object
    const connection = new HttpPollingConnection(peerId, channel.channelId)
    connection._setChannel(channel)

    // Store connection
    this.connections.set(peerId, connection)

    this.logger.info("Client connected", {
      peerId,
      channelId: channel.channelId,
      totalClients: this.connections.size,
    })

    return connection
  }

  /**
   * Unregister a peer connection.
   * This should be called when a peer disconnects or times out.
   *
   * @param peerId The unique identifier for the peer
   */
  unregisterConnection(peerId: PeerID): void {
    const connection = this.connections.get(peerId)
    if (connection) {
      connection.cancelWait()
      this.removeChannel(connection.channelId)
      this.connections.delete(peerId)

      this.logger.info("Client disconnected", {
        peerId,
        totalClients: this.connections.size,
      })
    }
  }

  /**
   * Get an active connection by peer ID.
   *
   * @param peerId The unique identifier for the peer
   * @returns The HttpPollingConnection if found, undefined otherwise
   */
  getConnection(peerId: PeerID): HttpPollingConnection | undefined {
    return this.connections.get(peerId)
  }

  /**
   * Get all active connections.
   *
   * @returns An array of all active HttpPollingConnection objects
   */
  getAllConnections(): HttpPollingConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Check if a peer is currently connected.
   *
   * @param peerId The unique identifier for the peer
   * @returns true if the peer is connected, false otherwise
   */
  isConnected(peerId: PeerID): boolean {
    return this.connections.has(peerId)
  }

  /**
   * Clean up connections that have been inactive for too long.
   */
  private cleanupStaleConnections(): void {
    const now = Date.now()
    const staleThreshold = now - this._connectionTimeout

    for (const [peerId, connection] of this.connections) {
      if (connection.lastActivity < staleThreshold) {
        this.logger.info("Cleaning up stale connection", {
          peerId,
          lastActivity: new Date(connection.lastActivity).toISOString(),
        })
        this.unregisterConnection(peerId)
      }
    }
  }

  /**
   * Get the connection timeout setting.
   */
  get connectionTimeout(): number {
    return this._connectionTimeout
  }
}
