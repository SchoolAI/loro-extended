import type { DocumentId, PeerId } from "src/types.js"

/** The base message interface. */
export interface UnsentMessageBase {
  targetIds: PeerId[]
}

/** Broadcasts the documents a peer has available upon connection. */
export interface UnsentAnnounceDocumentMessage extends UnsentMessageBase {
  type: "announce-document"
  documentIds: DocumentId[]
}

/** Informs a peer that a requested document is not available. */
export interface UnsentDocumentUnavailableMessage extends UnsentMessageBase {
  type: "document-unavailable"
  documentId: DocumentId
}

/** Requests the latest version of a document from a peer. */
export interface UnsentRequestSyncMessage extends UnsentMessageBase {
  type: "request-sync"
  documentId: DocumentId
}

/**
 * The core message for document synchronization. Contains Loro oplog and version info
 * depending on the type of sync (snapshot, shallow-snapshot, update, update-in-range).
 */
export interface UnsentSyncMessage extends UnsentMessageBase {
  type: "sync"
  documentId: DocumentId
  /** The sender's version vector for the document. Optional. */
  version?: Uint8Array
  /** Binary update data. Optional. */
  data?: Uint8Array
  /**
   * Hop count to prevent infinite forwarding cascades.
   * 0 = original message, 1 = forwarded once, etc.
   * Messages with hopCount >= 1 should not be forwarded again.
   * Required to prevent cascade bugs.
   */
  hopCount: number
}

/** A peer is requesting to delete a document. */
export interface UnsentDeleteDocumentMessage extends UnsentMessageBase {
  type: "delete-document"
  documentId: DocumentId
}

export type UnsentRepoMessage =
  | UnsentAnnounceDocumentMessage
  | UnsentRequestSyncMessage
  | UnsentSyncMessage
  | UnsentDocumentUnavailableMessage
  | UnsentDeleteDocumentMessage

/**
 * Sent Messages include senderId
 */

export interface SentMessageBase {
  senderId: PeerId
}

export interface AnnounceDocumentMessage
  extends UnsentAnnounceDocumentMessage,
    SentMessageBase {}
export interface RequestSyncMessage
  extends UnsentRequestSyncMessage,
    SentMessageBase {}
export interface SyncMessage extends UnsentSyncMessage, SentMessageBase {}
export interface DocumentUnavailableMessage
  extends UnsentDocumentUnavailableMessage,
    SentMessageBase {}
export interface DeleteDocumentMessage
  extends UnsentDeleteDocumentMessage,
    SentMessageBase {}

export type RepoMessage =
  | AnnounceDocumentMessage
  | RequestSyncMessage
  | SyncMessage
  | DocumentUnavailableMessage
  | DeleteDocumentMessage
