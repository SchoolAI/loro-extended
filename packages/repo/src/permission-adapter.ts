import type { DocumentId, PeerId } from "./types.js"

export interface PermissionAdapter {
  /**
   * Determines if this repo can share the existence of a document with a remote
   * peer. This is called when we first connect to a peer, and any time a new
   * document is created. If this returns false, the remote peer will not be
   * told about the document.
   *
   * @param peerId The ID of the remote peer.
   * @param documentId The ID of the document in question.
   * @returns `true` if listing the document is permitted, `false` otherwise.
   */
  canList(peerId: PeerId, documentId: DocumentId): boolean

  /**
   * Determines if we should accept a sync message from a remote peer for a
   * given document. This is called every time we receive a sync message. If
   * this returns false, the sync message will be ignored.
   *
   * @param peerId The ID of the peer proposing the change.
   * @param documentId The ID of the document being changed.
   * @returns `true` if writing is permitted, `false` otherwise.
   */
  canWrite(peerId: PeerId, documentId: DocumentId): boolean

  /**
   * Determines if a peer is allowed to delete a document.
   *
   * @param peerId The ID of the peer requesting the deletion.
   * @param documentId The ID of the document to be deleted.
   * @returns `true` if deletion is permitted, `false` otherwise.
   */
  canDelete(peerId: PeerId, documentId: DocumentId): boolean
}

export function createPermissions(
  permissions: Partial<PermissionAdapter> = {},
): PermissionAdapter {
  const defaultPermission = () => true
  return {
    canList: permissions?.canList ?? defaultPermission,
    canWrite: permissions?.canWrite ?? defaultPermission,
    canDelete: permissions?.canDelete ?? defaultPermission,
  }
}
