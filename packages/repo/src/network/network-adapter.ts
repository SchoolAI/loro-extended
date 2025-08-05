import type Emittery from "emittery"
import type { StorageId } from "../storage/storage-adapter.js"
import type { PeerId } from "../types.js"
import type { RepoMessage } from "./network-messages.js"

export interface PeerMetadata {
  storageId?: StorageId
}

export interface NetworkAdapterEvents {
  /** A potential peer has been discovered. */
  "peer-candidate": { peerId: PeerId; metadata: PeerMetadata }
  /** A peer has disconnected. */
  "peer-disconnected": { peerId: PeerId }
  /** A message has been received from a peer. */
  message: RepoMessage
}

export interface NetworkAdapter extends Emittery<NetworkAdapterEvents> {
  peerId?: PeerId

  /** Connect to the network and begin listening for peers. */
  connect(peerId: PeerId, metadata: PeerMetadata): void

  /** Send a message to a specific peer. */
  send(message: RepoMessage): void

  /** Disconnect from the network. */
  disconnect(): void
}
