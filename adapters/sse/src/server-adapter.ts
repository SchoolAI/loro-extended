import {
  Adapter,
  type Channel,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"

/**
 * Represents an active SSE connection to a peer.
 * This class manages the lifecycle of a single peer connection.
 */
export class SseConnection {
  private _channel: Channel | null = null
  private _sendFn: ((msg: ChannelMsg) => void) | null = null
  private _onDisconnect: (() => void) | null = null

  constructor(
    public readonly peerId: PeerID,
    public readonly channelId: number,
  ) {}

  /**
   * Set the function to call when sending messages to this peer.
   * This is typically called by the transport layer (e.g., Express router).
   */
  setSendFunction(sendFn: (msg: ChannelMsg) => void): void {
    this._sendFn = sendFn
  }

  /**
   * Set the function to call when this connection is disconnected.
   */
  setDisconnectHandler(handler: () => void): void {
    this._onDisconnect = handler
  }

  /**
   * Internal: Set the channel reference (called by adapter).
   */
  _setChannel(channel: Channel): void {
    this._channel = channel
  }

  /**
   * Send a message to the peer through the channel.
   */
  send(msg: ChannelMsg): void {
    if (!this._sendFn) {
      throw new Error(
        `Cannot send message: send function not set for peer ${this.peerId}`,
      )
    }
    this._sendFn(msg)
  }

  /**
   * Receive a message from the peer and route it to the channel.
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
   * Disconnect this connection.
   */
  disconnect(): void {
    this._onDisconnect?.()
  }
}

/**
 * Pure SSE server network adapter that manages peer connections.
 * This adapter is framework-agnostic and does not depend on Express or any HTTP framework.
 *
 * Use a router factory (like createSseExpressRouter) to integrate with your HTTP framework.
 */
export class SseServerNetworkAdapter extends Adapter<PeerID> {
  private connections = new Map<PeerID, SseConnection>()

  constructor() {
    super({ adapterId: "sse-server" })
  }

  protected generate(peerId: PeerID): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
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
    this.logger.info("SSE server adapter started")
  }

  async onStop(): Promise<void> {
    // Disconnect all active connections
    for (const connection of this.connections.values()) {
      connection.disconnect()
    }
    this.connections.clear()
    this.logger.info("SSE server adapter stopped")
  }

  /**
   * Register a new peer connection.
   * This should be called when a peer connects via SSE.
   *
   * @param peerId The unique identifier for the peer
   * @returns An SseConnection object that can be used to manage the connection
   */
  registerConnection(peerId: PeerID): SseConnection {
    // Create channel for this peer
    const channel = this.addChannel(peerId)

    // Create connection object
    const connection = new SseConnection(peerId, channel.channelId)
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
   * This should be called when a peer disconnects.
   *
   * @param peerId The unique identifier for the peer
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
   * Get an active connection by peer ID.
   *
   * @param peerId The unique identifier for the peer
   * @returns The SseConnection if found, undefined otherwise
   */
  getConnection(peerId: PeerID): SseConnection | undefined {
    return this.connections.get(peerId)
  }

  /**
   * Get all active connections.
   *
   * @returns An array of all active SseConnection objects
   */
  getAllConnections(): SseConnection[] {
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
}