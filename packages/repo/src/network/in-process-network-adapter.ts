import Emittery from "emittery"
import type { ChannelId } from "../types.js"
import { NetworkAdapter } from "./network-adapter.js"
import type { ChannelMsg } from "../channel.js"

interface InProcessBridgeEvents {
  "peer-added": { peerId: ChannelId; metadata: any }
  "peer-removed": { peerId: ChannelId }
  message: { message: ChannelMsg }
}

/**
 * A bridge that connects multiple InProcessNetworkAdapters within the same process.
 * This enables direct message passing between adapters for testing purposes.
 */
export class InProcessBridge extends Emittery<InProcessBridgeEvents> {
  readonly #adapters = new Map<ChannelId, InProcessNetworkAdapter>()

  /**
   * Register an adapter with this bridge
   */
  addAdapter(adapter: InProcessNetworkAdapter): void {
    if (!adapter.peerId) throw new Error("can't addAdapter without peerId")

    this.#adapters.set(adapter.peerId, adapter)
  }

  /**
   * Remove an adapter from this bridge
   */
  removeAdapter(peerId: ChannelId): void {
    this.#adapters.delete(peerId)
  }

  /**
   * Send a message through the bridge
   */
  send(message: ChannelMsg): void {
    this.emit("message", { message })
  }

  /**
   * Broadcast that a peer has been added to the network
   */
  peerAdded(peerId: ChannelId, metadata: any): void {
    this.emit("peer-added", { peerId, metadata })
  }

  /**
   * Broadcast that a peer has been removed from the network
   */
  peerRemoved(peerId: ChannelId): void {
    this.emit("peer-removed", { peerId })
  }

  /**
   * Get all peer IDs currently in the network
   */
  get peerIds(): Set<ChannelId> {
    return new Set(this.#adapters.keys())
  }

  /**
   * Get the metadata for a peer
   */
  getPeerMetadata(peerId: ChannelId): any {
    const adapter = this.#adapters.get(peerId)
    return adapter?.metadata
  }
}

/**
 * A network adapter for in-process communication between Repo instances.
 * This adapter is designed for testing scenarios where network communication
 * needs to be simulated without actual network overhead, e.g. testing.
 *
 * All adapters using the same bridge instance will be able to communicate
 * with each other directly.
 *
 * @example
 * ```typescript
 * // Create a shared bridge
 * const bridge = new InProcessBridge();
 *
 * // Create two adapters using the same bridge
 * const adapter1 = new InProcessNetworkAdapter("peer1", bridge);
 * const adapter2 = new InProcessNetworkAdapter("peer2", bridge);
 *
 * // Start both adapters
 * await adapter1.start("peer1", {});
 * await adapter2.start("peer2", {});
 *
 * // Send a message from peer1 to peer2
 * await adapter1.send({
 *   type: "announce-document",
 *   senderId: "peer1",
 *   targetId: "peer2",
 *   documentIds: ["doc1"]
 * });
 * ```
 */
export class InProcessNetworkAdapter extends NetworkAdapter {
  readonly #bridge: InProcessBridge
  #bridgeUnsubscribes: (() => void)[] = []

  peerId?: ChannelId
  metadata: any

  constructor(bridge: InProcessBridge) {
    super()
    this.#bridge = bridge
  }

  /**
   * Start participating in the in-process network.
   * Registers this adapter with the bridge and begins listening for network events.
   */
  async start(peerId: ChannelId, metadata: any = {}): Promise<void> {
    this.peerId = peerId
    this.metadata = metadata
    this.#bridge.addAdapter(this)

    // Listen for network events
    this.#bridgeUnsubscribes.push(
      this.#bridge.on(
        "peer-added",
        ({ peerId: newPeerId, metadata: newMetadata }) => {
          // Don't notify about ourselves
          if (newPeerId === peerId) return

          this.peerAvailable(newPeerId, newMetadata)
        },
      ),
    )

    this.#bridgeUnsubscribes.push(
      this.#bridge.on("peer-removed", ({ peerId: removedPeerId }) => {
        // Don't notify about ourselves
        if (removedPeerId === peerId) return

        this.peerDisconnected(removedPeerId)
      }),
    )

    this.#bridgeUnsubscribes.push(
      this.#bridge.on("message", ({ message }) => {
        // Only process messages intended for us
        if (!message.targetIds.includes(peerId)) return

        this.messageReceived(message)
      }),
    )

    // Notify network about our presence
    this.#bridge.peerAdded(peerId, metadata)

    // Notify about existing peers (excluding ourselves)
    // These will be queued until markAsReady() is called by the NetworkSubsystem
    for (const existingPeerId of this.#bridge.peerIds) {
      if (existingPeerId !== peerId) {
        // Get the existing adapter's metadata
        const existingMetadata = this.#bridge.getPeerMetadata(existingPeerId)
        if (existingMetadata !== undefined) {
          this.peerAvailable(existingPeerId, existingMetadata)
        }
      }
    }
  }

  /**
   * Send a message to peers via the bridge.
   * The bridge will route the message to the appropriate recipients.
   */
  async send(message: ChannelMsg): Promise<void> {
    this.#bridge.send(message)
  }

  /**
   * Stop participating in the in-process network.
   * Removes this adapter from the bridge and notifies other adapters.
   */
  async stop(): Promise<void> {
    if (!this.peerId) throw new Error("can't stop adapter: peerId not set")

    // Remove all bridge event listeners
    this.#bridgeUnsubscribes.forEach(unsubscribe => unsubscribe())
    this.#bridgeUnsubscribes = []

    this.#bridge.peerRemoved(this.peerId)
    this.#bridge.removeAdapter(this.peerId)
  }
}
