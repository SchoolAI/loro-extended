import {
  Adapter,
  type ChannelId,
  type ChannelMsg,
  deserializeChannelMsg,
  type GeneratedChannel,
  type PeerID,
  serializeChannelMsg,
} from "@loro-extended/repo"

/**
 * Context for each data channel - stores the remote peer ID
 */
type DataChannelContext = {
  remotePeerId: PeerID
  dataChannel: RTCDataChannel
}

/**
 * Internal tracking for attached data channels
 */
type AttachedChannel = {
  remotePeerId: PeerID
  dataChannel: RTCDataChannel
  channelId: ChannelId | null
  cleanup: () => void
}

/**
 * WebRTC Data Channel Adapter for loro-extended
 *
 * This adapter enables peer-to-peer document synchronization over WebRTC data channels.
 * It follows a "Bring Your Own Data Channel" approach - developers create and manage
 * their own WebRTC connections (e.g., using simple-peer), then attach the data channels
 * to this adapter for Loro sync.
 *
 * ## Usage
 *
 * ```typescript
 * import { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
 *
 * const webrtcAdapter = new WebRtcDataChannelAdapter()
 *
 * // Add to repo config
 * const config = {
 *   identity: { peerId, name, type: "user" },
 *   adapters: [sseAdapter, webrtcAdapter],
 * }
 *
 * // When a WebRTC connection is established (e.g., via simple-peer)
 * peer.on("connect", () => {
 *   const dataChannel = peer._pc.createDataChannel("loro-sync", { ordered: true })
 *   webrtcAdapter.attachDataChannel(remotePeerId, dataChannel)
 * })
 *
 * // When the connection closes
 * peer.on("close", () => {
 *   webrtcAdapter.detachDataChannel(remotePeerId)
 * })
 * ```
 *
 * ## Key Features
 *
 * - **Non-intrusive**: Doesn't manage WebRTC connections - works with any WebRTC setup
 * - **Multi-peer**: Supports multiple simultaneous peer connections
 * - **Automatic lifecycle**: Handles data channel open/close events
 * - **JSON serialization**: Compatible with other loro-extended adapters
 */
export class WebRtcDataChannelAdapter extends Adapter<DataChannelContext> {
  /**
   * Map of remotePeerId -> attached channel info
   */
  private attachedChannels = new Map<PeerID, AttachedChannel>()

  constructor() {
    super({ adapterId: "webrtc-datachannel" })
  }

  /**
   * Generate a channel for a data channel context.
   * Called by the base Adapter class when addChannel() is invoked.
   */
  protected generate(context: DataChannelContext): GeneratedChannel {
    const { remotePeerId, dataChannel } = context

    return {
      kind: "network",
      adapterId: this.adapterId,
      send: (msg: ChannelMsg) => {
        if (dataChannel.readyState !== "open") {
          this.logger.warn(
            "Cannot send message: data channel not open for peer {remotePeerId}",
            { remotePeerId },
          )
          return
        }

        const serialized = serializeChannelMsg(msg)
        dataChannel.send(JSON.stringify(serialized))
      },
      stop: () => {
        // Clean up is handled by detachDataChannel
        // This is called when the Loro channel is removed
      },
    }
  }

  /**
   * Called when the adapter starts.
   * For WebRTC, we don't create any channels here - they're created
   * dynamically when attachDataChannel() is called.
   */
  async onStart(): Promise<void> {
    this.logger.debug("WebRTC adapter started")
  }

  /**
   * Called when the adapter stops.
   * Clean up all attached data channels.
   */
  async onStop(): Promise<void> {
    this.logger.debug("WebRTC adapter stopping, cleaning up all channels")

    // Detach all channels
    for (const remotePeerId of this.attachedChannels.keys()) {
      this.detachDataChannel(remotePeerId)
    }
  }

  /**
   * Attach a data channel for a remote peer.
   *
   * Creates a Loro channel when the data channel is open (or when it opens).
   * The Loro channel will be used for document synchronization with the remote peer.
   *
   * @param remotePeerId - The stable peer ID of the remote peer
   * @param dataChannel - The RTCDataChannel to use for communication
   * @returns A cleanup function to detach the channel
   */
  attachDataChannel(
    remotePeerId: PeerID,
    dataChannel: RTCDataChannel,
  ): () => void {
    // Check if already attached
    if (this.attachedChannels.has(remotePeerId)) {
      this.logger.warn(
        "Data channel already attached for peer {remotePeerId}, detaching old one",
        { remotePeerId },
      )
      this.detachDataChannel(remotePeerId)
    }

    this.logger.debug(
      "Attaching data channel for peer {remotePeerId}, readyState: {readyState}",
      { remotePeerId, readyState: dataChannel.readyState },
    )

    // Event handlers
    const onOpen = () => {
      this.logger.debug("Data channel opened for peer {remotePeerId}", {
        remotePeerId,
      })
      this.createLoroChannel(remotePeerId, dataChannel)
    }

    const onClose = () => {
      this.logger.debug("Data channel closed for peer {remotePeerId}", {
        remotePeerId,
      })
      this.removeLoroChannel(remotePeerId)
    }

    const onError = (event: Event) => {
      this.logger.warn("Data channel error for peer {remotePeerId}: {error}", {
        remotePeerId,
        error: event,
      })
      this.removeLoroChannel(remotePeerId)
    }

    const onMessage = (event: MessageEvent) => {
      this.handleMessage(remotePeerId, event)
    }

    // Cleanup function to remove all event listeners
    const cleanup = () => {
      dataChannel.removeEventListener("open", onOpen)
      dataChannel.removeEventListener("close", onClose)
      dataChannel.removeEventListener("error", onError)
      dataChannel.removeEventListener("message", onMessage)
    }

    // Add event listeners
    dataChannel.addEventListener("open", onOpen)
    dataChannel.addEventListener("close", onClose)
    dataChannel.addEventListener("error", onError)
    dataChannel.addEventListener("message", onMessage)

    // Track the attached channel
    const attached: AttachedChannel = {
      remotePeerId,
      dataChannel,
      channelId: null,
      cleanup,
    }
    this.attachedChannels.set(remotePeerId, attached)

    // If already open, create the Loro channel immediately
    if (dataChannel.readyState === "open") {
      this.createLoroChannel(remotePeerId, dataChannel)
    }

    // Return cleanup function
    return () => this.detachDataChannel(remotePeerId)
  }

  /**
   * Detach a data channel for a remote peer.
   *
   * Removes the Loro channel and cleans up event listeners.
   *
   * @param remotePeerId - The peer ID to detach
   */
  detachDataChannel(remotePeerId: PeerID): void {
    const attached = this.attachedChannels.get(remotePeerId)
    if (!attached) {
      this.logger.debug("No data channel attached for peer {remotePeerId}", {
        remotePeerId,
      })
      return
    }

    this.logger.debug("Detaching data channel for peer {remotePeerId}", {
      remotePeerId,
    })

    // Remove the Loro channel if it exists
    this.removeLoroChannel(remotePeerId)

    // Clean up event listeners
    attached.cleanup()

    // Remove from tracking
    this.attachedChannels.delete(remotePeerId)
  }

  /**
   * Check if a data channel is attached for a peer.
   *
   * @param remotePeerId - The peer ID to check
   * @returns true if a data channel is attached
   */
  hasDataChannel(remotePeerId: PeerID): boolean {
    return this.attachedChannels.has(remotePeerId)
  }

  /**
   * Get all attached peer IDs.
   *
   * @returns Array of peer IDs with attached data channels
   */
  getAttachedPeerIds(): PeerID[] {
    return Array.from(this.attachedChannels.keys())
  }

  /**
   * Create a Loro channel for an open data channel.
   */
  private createLoroChannel(
    remotePeerId: PeerID,
    dataChannel: RTCDataChannel,
  ): void {
    const attached = this.attachedChannels.get(remotePeerId)
    if (!attached) {
      this.logger.warn(
        "Cannot create Loro channel: no attached channel for peer {remotePeerId}",
        { remotePeerId },
      )
      return
    }

    // Don't create if already exists
    if (attached.channelId !== null) {
      this.logger.debug("Loro channel already exists for peer {remotePeerId}", {
        remotePeerId,
      })
      return
    }

    // Create the Loro channel
    const channel = this.addChannel({ remotePeerId, dataChannel })
    attached.channelId = channel.channelId

    this.logger.debug(
      "Created Loro channel {channelId} for peer {remotePeerId}",
      { channelId: channel.channelId, remotePeerId },
    )

    // Establish the channel to start the handshake
    this.establishChannel(channel.channelId)
  }

  /**
   * Remove the Loro channel for a peer.
   */
  private removeLoroChannel(remotePeerId: PeerID): void {
    const attached = this.attachedChannels.get(remotePeerId)
    if (!attached || attached.channelId === null) {
      return
    }

    this.logger.debug(
      "Removing Loro channel {channelId} for peer {remotePeerId}",
      { channelId: attached.channelId, remotePeerId },
    )

    this.removeChannel(attached.channelId)
    attached.channelId = null
  }

  /**
   * Handle incoming messages from a data channel.
   */
  private handleMessage(remotePeerId: PeerID, event: MessageEvent): void {
    const attached = this.attachedChannels.get(remotePeerId)
    if (!attached || attached.channelId === null) {
      this.logger.warn(
        "Received message but no Loro channel for peer {remotePeerId}",
        { remotePeerId },
      )
      return
    }

    const channel = this.channels.get(attached.channelId)
    if (!channel) {
      this.logger.warn("Received message but channel {channelId} not found", {
        channelId: attached.channelId,
      })
      return
    }

    try {
      const data =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data)
      const serialized = JSON.parse(data)
      const message = deserializeChannelMsg(serialized)

      this.logger.trace(
        "Received message from peer {remotePeerId}: {messageType}",
        { remotePeerId, messageType: message.type },
      )

      channel.onReceive(message)
    } catch (error) {
      this.logger.warn(
        "Failed to parse message from peer {remotePeerId}: {error}",
        { remotePeerId, error },
      )
    }
  }
}
