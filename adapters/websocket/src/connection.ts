/**
 * WebSocket connection class for native loro-extended protocol.
 *
 * Manages a single WebSocket connection to a peer, directly transmitting
 * ChannelMsg types without protocol translation.
 */

import type { Channel, ChannelMsg, PeerID } from "@loro-extended/repo"
import type { WsSocket } from "./handler/types.js"
import { decodeFrame, encodeFrame } from "./wire-format.js"

/**
 * Represents a WebSocket connection to a peer.
 */
export class WsConnection {
  readonly peerId: PeerID
  readonly channelId: number

  private socket: WsSocket
  private channel: Channel | null = null
  private started = false

  constructor(peerId: PeerID, channelId: number, socket: WsSocket) {
    this.peerId = peerId
    this.channelId = channelId
    this.socket = socket
  }

  /**
   * Internal: Set the channel reference.
   * Called by the adapter when the channel is created.
   */
  _setChannel(channel: Channel): void {
    this.channel = channel
  }

  /**
   * Start processing messages on this connection.
   * Sets up message handlers for the WebSocket.
   */
  start(): void {
    if (this.started) {
      return
    }
    this.started = true

    this.socket.onMessage(data => {
      this.handleMessage(data)
    })
  }

  /**
   * Send a loro-extended message through the WebSocket.
   * Encodes directly to wire format without translation.
   */
  send(msg: ChannelMsg): void {
    if (this.socket.readyState !== "open") {
      return
    }

    const frame = encodeFrame(msg)
    this.socket.send(frame)
  }

  /**
   * Handle an incoming message from the WebSocket.
   */
  private handleMessage(data: Uint8Array | string): void {
    // Handle keepalive ping/pong (text frames)
    if (typeof data === "string") {
      this.handleKeepalive(data)
      return
    }

    // Handle binary protocol messages
    try {
      const messages = decodeFrame(data)
      for (const msg of messages) {
        this.handleChannelMessage(msg)
      }
    } catch (error) {
      console.error("Failed to decode wire message:", error)
    }
  }

  /**
   * Handle a decoded channel message.
   *
   * Delivers messages synchronously. The Synchronizer's receive queue handles
   * recursion prevention by queuing messages and processing them iteratively.
   */
  private handleChannelMessage(msg: ChannelMsg): void {
    if (!this.channel) {
      console.error("Cannot handle message: channel not set")
      return
    }

    // Deliver synchronously - the Synchronizer's receive queue prevents recursion
    this.channel.onReceive(msg)
  }

  /**
   * Handle keepalive ping/pong messages.
   */
  private handleKeepalive(text: string): void {
    if (text === "ping") {
      this.socket.send("pong")
    }
    // Ignore "pong" and "ready" responses
  }

  /**
   * Send a "ready" signal to the client.
   * This tells the client that the server is ready to receive messages.
   */
  sendReady(): void {
    if (this.socket.readyState !== "open") {
      return
    }
    this.socket.send("ready")
  }

  /**
   * Close the connection.
   */
  close(code?: number, reason?: string): void {
    this.socket.close(code, reason)
  }

  /**
   * Simulate the establishment handshake to satisfy loro-extended's requirements.
   *
   * Delivers messages synchronously. The Synchronizer's receive queue handles
   * recursion prevention by queuing messages and processing them iteratively.
   *
   * @param remotePeerId The peer ID of the remote peer
   */
  simulateHandshake(remotePeerId: PeerID): void {
    if (!this.channel) return

    // Deliver synchronously - the Synchronizer's receive queue prevents recursion
    // 1. We tell Synchronizer that the remote peer wants to establish
    this.channel.onReceive({
      type: "channel/establish-request",
      identity: { peerId: remotePeerId, name: "peer", type: "user" },
    })

    // 2. We tell Synchronizer that the remote peer accepted our establishment
    this.channel.onReceive({
      type: "channel/establish-response",
      identity: { peerId: remotePeerId, name: "peer", type: "user" },
    })
  }
}
