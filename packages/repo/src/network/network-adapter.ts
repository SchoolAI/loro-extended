import Emittery, {
  type OmnipresentEventData,
  type UnsubscribeFunction,
} from "emittery"
import type { ChannelId } from "../types.js"
import type { ChannelMsg } from "../channel.js"

export type PeerMetadata = object

export interface NetworkAdapterEvents {
  /**
   * A peer has connected or become available for communication.
   * The adapter must emit this when it discovers or accepts a new peer.
   */
  "peer-available": { peerId: ChannelId; metadata: PeerMetadata }

  /**
   * A peer has disconnected and is no longer available.
   * The adapter must emit this to allow the Repo to clean up resources.
   */
  "peer-disconnected": { peerId: ChannelId }

  /**
   * A message was received from a peer.
   * The adapter must emit this for all incoming messages.
   */
  "message-received": { message: ChannelMsg }
}

/**
 * @deprecated Use Adapter<G> directly instead. This class will be removed in a future version.
 *
 * NetworkAdapter provided an event-based abstraction that is no longer needed.
 * Extend Adapter<G> and implement the channel-based pattern instead.
 *
 * A base class for all network adapters, e.g. SSE, WebSocket, etc. both client and server.
 *
 * Implementing a subclass
 *
 * # Required Methods
 *
 * - `start`
 * - `stop`
 * - `send`
 *
 * See method docs for details.
 *
 * # Required Actions
 *
 * ## Report peer availability
 *
 * When a peer becomes available for communication, you MUST call:
 *
 *   `this.peerAvailable(peerId, metadata)`
 *
 * ## Report peer disconnection
 *
 * When a peer disconnects, you MUST call:
 *
 *   `this.peerDisconnected(peerId)`
 *
 * ## Report received messages
 *
 * When you receive a message from a peer, you MUST call:
 *
 *   `this.messageReceived(message)`
 */
export abstract class NetworkAdapter {
  readonly #emitter = new Emittery<NetworkAdapterEvents>()
  #eventQueue: Array<{ eventName: keyof NetworkAdapterEvents; data: any }> = []
  #isReady = false

  public on<Name extends keyof NetworkAdapterEvents>(
    eventName: Name | readonly Name[],
    listener: (
      eventData: (NetworkAdapterEvents & OmnipresentEventData)[Name],
    ) => void | Promise<void>,
    options?: { signal?: AbortSignal },
  ): UnsubscribeFunction {
    return this.#emitter.on(eventName, listener, options)
  }

  /**
   * Emit an event, either immediately or queue it if not ready
   */
  protected emitEvent<Name extends keyof NetworkAdapterEvents>(
    eventName: Name,
    data: NetworkAdapterEvents[Name],
  ): void {
    if (this.#isReady) {
      // Emit directly when ready
      this.#emitter.emit(eventName, data)
    } else {
      // Queue the event when not ready
      this.#eventQueue.push({ eventName, data })
    }
  }

  /**
   * Mark the adapter as ready and emit any queued events
   */
  public markAsReady(): void {
    if (!this.#isReady) {
      this.#isReady = true

      // Emit all queued events in order
      for (const { eventName, data } of this.#eventQueue) {
        this.#emitter.emit(eventName, data)
      }

      // Clear the queue
      this.#eventQueue = []
    }
  }

  /**
   * Send a message to a specific peer.
   *
   * REQUIRED
   *
   * This is called by the NetworkSubsystem when it has determined that this
   * NetworkAdapter is responsible for sending messages to a specific peerId.
   *
   * The message itself contains sender and receiver peer IDs. If the peer does
   * not exist, or there is an error in transmission, `send` MUST throw an Error
   * so that another adapter can potentially be given an opportunity to try to
   * deliver to the target.
   */
  abstract send(message: ChannelMsg): Promise<void>

  /**
   * Activate this network adapter.
   *
   * REQUIRED
   *
   * Called by the Repo once all internal systems are ready. Implementers should:
   * - Begin listening for new connections (if a server adapter)
   * - Establish connection to a server (if a client adapter)
   *
   * This method must initialize all event-based communication for this peer,
   * and call `this.peerAvailable()` for all discovered or connecting peers.
   */
  abstract start(peerId: ChannelId, metadata?: PeerMetadata): Promise<void>

  /**
   * Disconnect from the network.
   *
   * REQUIRED
   *
   * This is called by the NetworkSubsystem when shutting down.
   */
  abstract stop(): Promise<void>

  /**
   * Report that a peer is available for communication.
   * Subclasses MUST call this when they discover or accept a new peer.
   */
  protected peerAvailable(peerId: ChannelId, metadata: PeerMetadata): void {
    this.emitEvent("peer-available", { peerId, metadata })
  }

  /**
   * Report that a peer has disconnected.
   * Subclasses MUST call this when a peer is no longer available.
   */
  protected peerDisconnected(peerId: ChannelId): void {
    this.emitEvent("peer-disconnected", { peerId })
  }

  /**
   * Report that a message was received from a peer.
   * Subclasses MUST call this for all incoming messages.
   */
  protected messageReceived(message: ChannelMsg): void {
    this.emitEvent("message-received", { message })
  }
}
