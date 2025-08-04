import type { DocumentId, PeerId } from "../types.js"

export interface PermissionAdapter {
  /**
   * Determines if a peer is allowed to share a document ID with other peers.
   * @param peerId The ID of the peer creating the document.
   * @param documentId The ID of the document being shared.
   * @returns `true` if sharing is permitted, `false` otherwise.
   */
  canRevealDocumentId(peerId: PeerId, documentId: DocumentId): Promise<boolean> | boolean

  /**
   * Determines if a peer's changes are allowed to be applied to a document.
   * @param peerId The ID of the peer proposing the change.
   * @param documentId The ID of the document being changed.
   * @returns `true` if writing is permitted, `false` otherwise.
   */
  canWrite(peerId: PeerId, documentId: DocumentId): Promise<boolean> | boolean

  /**
   * Determines if a peer is allowed to delete a document.
   * @param peerId The ID of the peer requesting the deletion.
   * @param documentId The ID of the document to be deleted.
   * @returns `true` if deletion is permitted, `false` otherwise.
   */
  canDelete(peerId: PeerId, documentId: DocumentId): Promise<boolean> | boolean
}
