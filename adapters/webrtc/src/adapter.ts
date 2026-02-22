import {
  Adapter,
  type ChannelId,
  type ChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"
import {
  decodeFrame,
  encodeFrame,
  FragmentReassembler,
  fragmentPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"

/**
 * Default fragment threshold in bytes.
 * Messages larger than this are fragmented for SCTP compatibility.
 * SCTP has a ~256KB message size limit, so 200KB provides a safe margin.
 */
export const DEFAULT_FRAGMENT_THRESHOLD = 200 * 1024

/**
 * Configuration options for the WebRTC adapter.
 */
export interface WebRtcAdapterOptions {
  /**
   * Fragment threshold in bytes. Messages larger than this are fragmented.
   * Set to 0 to disable fragmentation (not recommended).
   * Default: 200KB (safe for SCTP's 256KB limit)
   */
  fragmentThreshold?: number
}

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
  reassembler: FragmentReassembler
}

/**
 * WebRTC Data Channel Adapter for loro-extended
 *
 * This adapter enables peer-to-peer document synchronization over WebRTC data channels.
 * It follows a "Bring Your Own Data Channel" approach - developers create and manage
 * their own WebRTC connections (e.g., using simple-peer), then attach the data channels
 * to this adapter for Loro sync.
 *
 * ## Wire Format
 *
 * This adapter uses binary CBOR encoding (v2 wire format) with transport-layer
 * fragmentation for large payloads. This provides ~33% bandwidth savings compared
 * to the previous JSON+base64 encoding.
 *
 * **Important**: All peers must use the same wire format version. Mixing v1 (JSON)
 * and v2 (binary CBOR) peers will cause decode failures.
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
 * - **Binary encoding**: CBOR binary encoding for bandwidth efficiency
 * - **Fragmentation**: Large payloads are automatically fragmented for SCTP compatibility
 */
export class WebRtcDataChannelAdapter extends Adapter<DataChannelContext> {
  /**
   * Map of remotePeerId -> attached channel info
   */
  private attachedChannels = new Map<PeerID, AttachedChannel>()

  /**
   * Fragment threshold in bytes
   */
  private readonly fragmentThreshold: number

  constructor(options?: WebRtcAdapterOptions) {
    super({ adapterType: "webrtc-datachannel" })
    this.fragmentThreshold =
      options?.fragmentThreshold ?? DEFAULT_FRAGMENT_THRESHOLD
  }

  /**
   * Generate a channel for a data channel context.
   * Called by the base Adapter class when addChannel() is invoked.
   */
  protected generate(context: DataChannelContext): GeneratedChannel {
    const { remotePeerId, dataChannel } = context

    return {
      kind: "network",
      adapterType: this.adapterType,
      send: (msg: ChannelMsg) => {
        if (dataChannel.readyState !== "open") {
          this.logger.warn(
            "Cannot send message: data channel not open for peer {remotePeerId}",
            { remotePeerId },
          )
          return
        }

        // Encode to binary CBOR wire format
        const frame = encodeFrame(msg)

        // Fragment large payloads for SCTP compatibility
        if (
          this.fragmentThreshold > 0 &&
          frame.length > this.fragmentThreshold
        ) {
          const fragments = fragmentPayload(frame, this.fragmentThreshold)
          for (const fragment of fragments) {
            // RTCDataChannel.send accepts ArrayBufferView which includes Uint8Array
            // Use type assertion to satisfy strict DOM types
            dataChannel.send(fragment as unknown as ArrayBuffer)
          }
        } else {
          // Wrap with MESSAGE_COMPLETE prefix for transport layer consistency
          const wrapped = wrapCompleteMessage(frame)
          dataChannel.send(wrapped as unknown as ArrayBuffer)
        }
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

    // Set binary type to arraybuffer for binary CBOR messages
    dataChannel.binaryType = "arraybuffer"

    // Create reassembler for this data channel
    const reassembler = new FragmentReassembler({
      timeoutMs: 10000,
      onTimeout: (batchId: Uint8Array) => {
        this.logger.warn(
          "Fragment batch timed out for peer {remotePeerId}: {batchId}",
          {
            remotePeerId,
            batchId: Array.from(batchId)
              .map((b: number) => b.toString(16).padStart(2, "0"))
              .join(""),
          },
        )
      },
    })

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
      reassembler,
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

    // Dispose the reassembler to clean up timers
    attached.reassembler.dispose()

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
      // Handle binary messages through reassembler
      if (event.data instanceof ArrayBuffer) {
        const result = attached.reassembler.receiveRaw(
          new Uint8Array(event.data),
        )

        if (result.status === "complete") {
          // Decode the reassembled frame
          const messages = decodeFrame(result.data)
          for (const msg of messages) {
            this.logger.trace(
              "Received message from peer {remotePeerId}: {messageType}",
              { remotePeerId, messageType: msg.type },
            )
            channel.onReceive(msg)
          }
        } else if (result.status === "error") {
          this.logger.error(
            "Fragment reassembly error for peer {remotePeerId}: {error}",
            { remotePeerId, error: result.error },
          )
        }
        // "pending" status means we're waiting for more fragments - nothing to do
      } else {
        // Unexpected string message - log warning
        this.logger.warn(
          "Received unexpected string message from peer {remotePeerId}",
          { remotePeerId },
        )
      }
    } catch (error) {
      this.logger.warn(
        "Failed to decode message from peer {remotePeerId}: {error}",
        { remotePeerId, error },
      )
    }
  }
}
