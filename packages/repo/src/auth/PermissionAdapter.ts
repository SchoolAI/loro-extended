import type { DocumentId, PeerId } from "../types.js"

export interface PermissionAdapter {
  /**
   * Determines if this repo can reveal the existence of a document to a remote peer.
   * @param peerId The ID of the remote peer.
   * @param documentId The ID of the document being shared.
   * @returns `true` if sharing is permitted, `false` otherwise.
   */
  canRevealDocumentId?(
    peerId: PeerId,
    documentId: DocumentId,
  ): Promise<boolean> | boolean

  /**
   * Determines if a peer's changes are allowed to be applied to a document.
   * @param peerId The ID of the peer proposing the change.
   * @param documentId The ID of the document being changed.
   * @returns `true` if writing is permitted, `false` otherwise.
   */
  canWrite?(peerId: PeerId, documentId: DocumentId): Promise<boolean> | boolean

  /**
   * Determines if a peer is allowed to delete a document.
   * @param peerId The ID of the peer requesting the deletion.
   * @param documentId The ID of the document to be deleted.
   * @returns `true` if deletion is permitted, `false` otherwise.
   */
  canDelete?(peerId: PeerId, documentId: DocumentId): Promise<boolean> | boolean
}
