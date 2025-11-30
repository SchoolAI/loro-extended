/**
 * WebSocket connection class.
 *
 * Manages a single WebSocket connection to a peer, handling message
 * translation between the Loro Syncing Protocol and loro-extended messages.
 */

import type { Channel, ChannelMsg, PeerID } from "@loro-extended/repo"
import type { WsSocket } from "./handler/types.js"
import { decodeMessage, encodeMessage } from "./protocol/index.js"
import {
  createTranslationContext,
  fromProtocolMessage,
  type TranslationContext,
  toProtocolMessages,
} from "./protocol/translation.js"
import type { ProtocolMessage } from "./protocol/types.js"

/**
 * Represents a WebSocket connection to a peer.
 */
export class WsConnection {
  readonly peerId: PeerID
  readonly channelId: number

  private socket: WsSocket
  private channel: Channel | null = null
  private joinedRooms = new Set<string>()
  private translationContext: TranslationContext
  private started = false

  constructor(peerId: PeerID, channelId: number, socket: WsSocket) {
    this.peerId = peerId
    this.channelId = channelId
    this.socket = socket
    this.translationContext = createTranslationContext()
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

    // We don't register onClose/onError here because the adapter handles cleanup
    // and the WsSocket interface typically supports only one handler.
    // If WsConnection needs to handle close/error, we should change the architecture
    // to have the adapter notify the connection or support multiple listeners.
  }

  /**
   * Send a loro-extended message through the WebSocket.
   * Translates the message to Loro Protocol format before sending.
   */
  send(msg: ChannelMsg): void {
    if (this.socket.readyState !== "open") {
      return
    }

    const protocolMsgs = toProtocolMessages(msg, this.translationContext)

    for (const pmsg of protocolMsgs) {
      this.sendProtocolMessage(pmsg)
    }
  }

  /**
   * Send a raw protocol message.
   */
  sendProtocolMessage(msg: ProtocolMessage): void {
    if (this.socket.readyState !== "open") {
      return
    }

    const encoded = encodeMessage(msg)
    this.socket.send(encoded)
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
      const msg = decodeMessage(data)
      this.handleProtocolMessage(msg)
    } catch (error) {
      console.error("Failed to decode protocol message:", error)
    }
  }

  /**
   * Handle a decoded protocol message.
   */
  private handleProtocolMessage(msg: ProtocolMessage): void {
    if (!this.channel) {
      console.error("Cannot handle message: channel not set")
      return
    }

    // Track room joins
    if (msg.type === 0x00) {
      // JoinRequest
      this.joinedRooms.add(msg.roomId)
    } else if (msg.type === 0x01) {
      // JoinResponseOk
      this.joinedRooms.add(msg.roomId)
    } else if (msg.type === 0x07) {
      // Leave
      this.joinedRooms.delete(msg.roomId)
    }

    // Translate to loro-extended message
    const translated = fromProtocolMessage(msg, this.translationContext)

    if (translated) {
      this.channel.onReceive(translated.channelMsg)
    }
  }

  /**
   * Handle keepalive ping/pong messages.
   */
  private handleKeepalive(text: string): void {
    if (text === "ping") {
      this.socket.send("pong")
    }
    // Ignore "pong" responses
  }

  /**
   * Close the connection.
   */
  close(code?: number, reason?: string): void {
    this.socket.close(code, reason)
  }

  /**
   * Check if a room (docId) is joined.
   */
  isRoomJoined(roomId: string): boolean {
    return this.joinedRooms.has(roomId)
  }

  /**
   * Get all joined rooms.
   */
  getJoinedRooms(): string[] {
    return Array.from(this.joinedRooms)
  }

  /**
   * Get the translation context for this connection.
   */
  getTranslationContext(): TranslationContext {
    return this.translationContext
  }

  /**
   * Simulate the establishment handshake to satisfy loro-extended's requirements.
   * This is necessary because the Loro Protocol doesn't have a peer-level handshake,
   * but the Synchronizer expects one before sending sync messages.
   *
   * @param remotePeerId The peer ID of the remote peer
   */
  simulateHandshake(remotePeerId: PeerID): void {
    if (!this.channel) return

    // Simulate receiving establish-request (if we are server)
    // or establish-response (if we are client)
    // To be safe, we can simulate both directions to ensure state is consistent

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
