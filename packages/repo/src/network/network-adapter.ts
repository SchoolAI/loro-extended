import type Emittery from "emittery"
import type { StorageId } from "../storage/storage-adapter.js"
import type { DocumentId, PeerId } from "../types.js"

export interface PeerMetadata {
  storageId?: StorageId
}

/** The base message interface. */
export interface Message {
  type: "announce-document" | "request-sync" | "sync" | "document-unavailable"
  senderId: PeerId
  targetId: PeerId
  documentId?: DocumentId
}

/** Broadcasts the documents a peer has available upon connection. */
export interface AnnounceDocumentMessage extends Message {
  type: "announce-document"
  documentIds: DocumentId[]
}

/** Requests the latest version of a document from a peer. */
export interface RequestSyncMessage extends Message {
  type: "request-sync"
  documentId: DocumentId
}

/**
 * The core message for document synchronization.
 * It contains the sender's version of the document.
 * The recipient uses this version to calculate the necessary updates.
 * This message may also contain binary update data.
 */
export interface SyncMessage extends Message {
  type: "sync"
  documentId: DocumentId
  /** The sender's version vector for the document. Optional. */
  version?: Uint8Array
  /** Binary update data. Optional. */
  data?: Uint8Array
}

/** Informs a peer that a requested document is not available. */
export interface DocumentUnavailableMessage extends Message {
  type: "document-unavailable"
  documentId: DocumentId
}

export type RepoMessage =
  | AnnounceDocumentMessage
  | RequestSyncMessage
  | SyncMessage
  | DocumentUnavailableMessage

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
