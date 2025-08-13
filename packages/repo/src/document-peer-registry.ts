import { create } from "mutative"
import { addToSet, removeFromSet } from "./map-set-utils.js"
import type { DocumentId, PeerId } from "./types.js"

/**
 * DocumentPeerRegistry tracks document-specific peer relationships.
 * It maintains separate maps for peers that HAVE documents and peers that KNOW ABOUT documents.
 */
export type DocumentPeerRegistry = {
  /** Peers that HAVE each document (they announced it to us). */
  peersWithDoc: Map<DocumentId, Set<PeerId>>

  /** Peers that KNOW ABOUT each document (we announced to them or they requested it). */
  peersAwareOfDoc: Map<DocumentId, Set<PeerId>>
}

export function createDocumentPeerRegistry(): DocumentPeerRegistry {
  return {
    peersWithDoc: new Map(),
    peersAwareOfDoc: new Map(),
  }
}

/**
 * Add a peer to the set of peers that have a specific document.
 */
export function addPeersWithDocuments(
  registry: DocumentPeerRegistry,
  peerIds: PeerId[],
  documentIds: DocumentId[],
): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    for (const documentId of documentIds) {
      addToSet(draft.peersWithDoc, documentId, peerIds)
    }
  })
}

/**
 * Remove a peer from the set of peers that have a specific document.
 */
export function removePeersFromDocuments(
  registry: DocumentPeerRegistry,
  peerIds: PeerId[],
  documentIds: DocumentId[],
): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    for (const documentId of documentIds) {
      removeFromSet(draft.peersWithDoc, documentId, peerIds)
    }
  })
}

/**
 * Add a peer to the set of peers that are aware of a specific document.
 */
export function addPeersAwareOfDocuments(
  registry: DocumentPeerRegistry,
  peerIds: PeerId[],
  documentIds: DocumentId[],
): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    for (const documentId of documentIds) {
      addToSet(draft.peersAwareOfDoc, documentId, peerIds)
    }
  })
}

/**
 * Remove a peer from the set of peers that are aware of a specific document.
 */
export function removePeersAwareOfDocuments(
  registry: DocumentPeerRegistry,
  peerIds: PeerId[],
  documentIds: DocumentId[],
): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    for (const documentId of documentIds) {
      removeFromSet(draft.peersAwareOfDoc, documentId, peerIds)
    }
  })
}

/**
 * Get all peers that have a specific document.
 */
export function getPeersWithDocument(
  registry: DocumentPeerRegistry,
  documentId: DocumentId,
): PeerId[] {
  const peers = registry.peersWithDoc.get(documentId)
  return peers ? Array.from(peers) : []
}

/**
 * Get all peers that are aware of a specific document.
 */
export function getPeersAwareOfDocument(
  registry: DocumentPeerRegistry,
  documentId: DocumentId,
): PeerId[] {
  const peers = registry.peersAwareOfDoc.get(documentId)
  return peers ? Array.from(peers) : []
}

/**
 * Check if a specific peer is aware of a specific document.
 */
export function isPeerAwareOfDocument(
  registry: DocumentPeerRegistry,
  peerId: PeerId,
  documentId: DocumentId,
): boolean {
  const peers = registry.peersAwareOfDoc.get(documentId)
  return peers ? peers.has(peerId) : false
}

/**
 * Remove a peer from all document relationships.
 * This should be called when a peer disconnects.
 */
export function removePeerFromAllDocuments(
  registry: DocumentPeerRegistry,
  peerId: PeerId,
): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    // Remove from peersWithDoc
    for (const [documentId, peers] of draft.peersWithDoc.entries()) {
      if (peers.has(peerId)) {
        peers.delete(peerId)
        if (peers.size === 0) {
          draft.peersWithDoc.delete(documentId)
        }
      }
    }

    // Remove from peersAwareOfDoc
    for (const [documentId, peers] of draft.peersAwareOfDoc.entries()) {
      if (peers.has(peerId)) {
        peers.delete(peerId)
        if (peers.size === 0) {
          draft.peersAwareOfDoc.delete(documentId)
        }
      }
    }
  })
}

/**
 * Clear all document relationships.
 * This should be called when shutting down.
 */
export function clear(registry: DocumentPeerRegistry): DocumentPeerRegistry {
  return create(registry, (draft: DocumentPeerRegistry) => {
    draft.peersWithDoc.clear()
    draft.peersAwareOfDoc.clear()
  })
}
