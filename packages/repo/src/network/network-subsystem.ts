import Emittery from "emittery"

import type { PeerId } from "../types.js"
import type { NetworkAdapter, PeerMetadata } from "./network-adapter.js"
import type { RepoMessage, UnsentRepoMessage } from "./network-messages.js"

interface NetworkSubsystemEvents {
  peer: { peerId: PeerId; metadata: PeerMetadata }
  "peer-disconnected": { peerId: PeerId }
  message: RepoMessage
}

export class NetworkSubsystem extends Emittery<NetworkSubsystemEvents> {
  #adapters: NetworkAdapter[]
  #peerId: PeerId
  #peerMetadata: PeerMetadata

  constructor(
    adapters: NetworkAdapter[],
    peerId: PeerId,
    peerMetadata: PeerMetadata,
  ) {
    super()
    this.#peerId = peerId
    this.#peerMetadata = peerMetadata
    this.#adapters = adapters
    this.#adapters.forEach(adapter => this.#initializeAdapter(adapter))
  }

  #initializeAdapter(adapter: NetworkAdapter) {
    adapter.on("peer-candidate", ({ peerId, metadata }) => {
      this.emit("peer", { peerId, metadata })
    })

    adapter.on("peer-disconnected", ({ peerId }) => {
      this.emit("peer-disconnected", { peerId })
    })

    adapter.on("message", message => {
      this.emit("message", message)
    })

    adapter.connect(this.#peerId, this.#peerMetadata)
  }

  send(message: UnsentRepoMessage) {
    this.#adapters.forEach(adapter =>
      adapter.send({
        ...message,
        senderId: this.#peerId,
      }),
    )
  }
}
