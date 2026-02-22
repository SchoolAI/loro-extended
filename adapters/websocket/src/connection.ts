/**
 * WebSocket connection class for native loro-extended protocol.
 *
 * Manages a single WebSocket connection to a peer, directly transmitting
 * ChannelMsg types without protocol translation.
 */

import type { Channel, ChannelMsg, PeerID } from "@loro-extended/repo"
import {
  decodeFrame,
  encodeFrame,
  FragmentReassembler,
  fragmentPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"
import type { WsSocket } from "./handler/types.js"

/**
 * Default fragment threshold in bytes.
 * Messages larger than this are fragmented for cloud infrastructure compatibility.
 * AWS API Gateway has a 128KB limit, so 100KB provides a safe margin.
 */
export const DEFAULT_FRAGMENT_THRESHOLD = 100 * 1024

/**
 * Configuration for creating a WsConnection.
 */
export interface WsConnectionConfig {
  /**
   * Fragment threshold in bytes. Messages larger than this are fragmented.
   * Set to 0 to disable fragmentation (not recommended for cloud deployments).
   * Default: 100KB (safe for AWS API Gateway's 128KB limit)
   */
  fragmentThreshold?: number
}

/**
 * Represents a WebSocket connection to a peer.
 */
export class WsConnection {
  readonly peerId: PeerID
  readonly channelId: number

  private socket: WsSocket
  private channel: Channel | null = null
  private started = false

  // Fragmentation support
  private readonly fragmentThreshold: number
  private readonly reassembler: FragmentReassembler

  constructor(
    peerId: PeerID,
    channelId: number,
    socket: WsSocket,
    config?: WsConnectionConfig,
  ) {
    this.peerId = peerId
    this.channelId = channelId
    this.socket = socket
    this.fragmentThreshold =
      config?.fragmentThreshold ?? DEFAULT_FRAGMENT_THRESHOLD
    this.reassembler = new FragmentReassembler({
      timeoutMs: 10000,
      onTimeout: batchId => {
        console.warn(
          `[WsConnection] Fragment batch timed out: ${Array.from(batchId)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("")}`,
        )
      },
    })
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

    // Fragment large payloads for cloud infrastructure compatibility
    if (this.fragmentThreshold > 0 && frame.length > this.fragmentThreshold) {
      const fragments = fragmentPayload(frame, this.fragmentThreshold)
      for (const fragment of fragments) {
        this.socket.send(fragment)
      }
    } else {
      // Wrap with MESSAGE_COMPLETE prefix for transport layer consistency
      this.socket.send(wrapCompleteMessage(frame))
    }
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

    // Handle binary protocol messages through reassembler
    const result = this.reassembler.receiveRaw(data)

    if (result.status === "complete") {
      try {
        const messages = decodeFrame(result.data)
        for (const msg of messages) {
          this.handleChannelMessage(msg)
        }
      } catch (error) {
        console.error("Failed to decode wire message:", error)
      }
    } else if (result.status === "error") {
      console.error("Fragment reassembly error:", result.error)
    }
    // "pending" status means we're waiting for more fragments - nothing to do
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
   * Close the connection and clean up resources.
   */
  close(code?: number, reason?: string): void {
    this.reassembler.dispose()
    this.socket.close(code, reason)
  }
}
