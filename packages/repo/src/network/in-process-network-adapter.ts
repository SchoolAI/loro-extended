import Emittery from "emittery"

import type { PeerId } from "../types.js"
import type {
  NetworkAdapter,
  NetworkAdapterEvents,
  PeerMetadata,
  RepoMessage,
} from "./network-adapter.js"

/**
 * A "network" adapter that allows for direct, in-process communication
 * between two Repo instances. This is useful for testing.
 *
 * It uses a static broker to connect all instances of the adapter together.
 */
export class InProcessNetworkAdapter
  extends Emittery<NetworkAdapterEvents>
  implements NetworkAdapter
{
  peerId?: PeerId
  #broker: InProcessNetworkBroker

  constructor(broker = inProcessNetworkBroker) {
    super()
    this.#broker = broker
  }

  connect(peerId: PeerId, metadata: PeerMetadata): void {
    this.peerId = peerId
    this.#broker.addPeer(peerId, metadata, this)
  }

  send(message: RepoMessage): void {
    const { targetId } = message
    this.#broker.sendMessage(targetId, message)
  }

  disconnect(): void {
    if (this.peerId) {
      this.#broker.removePeer(this.peerId)
    }
  }
}

/** The "broker" is a shared space for all InProcessNetworkAdapters to find each other. */
export class InProcessNetworkBroker {
  #peers = new Map<
    PeerId,
    { metadata: PeerMetadata; adapter: InProcessNetworkAdapter }
  >()

  addPeer(
    peerId: PeerId,
    metadata: PeerMetadata,
    adapter: InProcessNetworkAdapter,
  ) {
    // Announce the new peer to all existing peers
    for (const [existingPeerId, existingPeer] of this.#peers.entries()) {
      existingPeer.adapter.emit("peer-candidate", { peerId, metadata })
      // Announce existing peers to the new one
      adapter.emit("peer-candidate", {
        peerId: existingPeerId,
        metadata: existingPeer.metadata,
      })
    }
    this.#peers.set(peerId, { metadata, adapter })
  }

  sendMessage(targetId: PeerId, message: RepoMessage) {
    const peer = this.#peers.get(targetId)
    if (peer) {
      // The `message` event is emitted on the target adapter, which is then
      // picked up by the NetworkSubsystem and passed to the Repo.
      peer.adapter.emit("message", message)
    }
  }

  removePeer(peerId: PeerId) {
    this.#peers.delete(peerId)
    for (const { adapter } of this.#peers.values()) {
      adapter.emit("peer-disconnected", { peerId })
    }
  }
}

/** A singleton broker for all InProcessNetworkAdapters to use. */
const inProcessNetworkBroker = new InProcessNetworkBroker()
