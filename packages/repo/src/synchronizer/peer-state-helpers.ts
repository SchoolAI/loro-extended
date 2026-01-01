import type { VersionVector } from "loro-crdt"
import type { ConnectedChannel } from "../channel.js"
import type { SynchronizerModel } from "../synchronizer-program.js"
import type {
  ChannelId,
  DocId,
  DocState,
  PeerDocSyncState,
  PeerID,
  PeerIdentityDetails,
  PeerState,
} from "../types.js"

/**
 * Get or create peer state (replaces temporary peerId generation)
 */
export function ensurePeerState(
  model: SynchronizerModel,
  identity: PeerIdentityDetails,
  channelId: ChannelId,
): PeerState {
  const peerId = identity.peerId
  let peerState = model.peers.get(peerId)

  if (!peerState) {
    peerState = {
      identity,
      docSyncStates: new Map(),
      subscriptions: new Set(),
      channels: new Set(),
    }
    model.peers.set(peerId, peerState)
  }

  // Track this channel for the peer
  peerState.channels.add(channelId)

  return peerState
}

/**
 * Add a document to peer's subscriptions
 */
export function addPeerSubscription(peerState: PeerState, docId: DocId): void {
  peerState.subscriptions.add(docId)
}

/**
 * Remove a document from peer's subscriptions
 */
export function removePeerSubscription(
  peerState: PeerState,
  docId: DocId,
): void {
  peerState.subscriptions.delete(docId)
}

/**
 * Check if peer has subscribed to a document
 */
export function hasPeerSubscription(
  peerState: PeerState,
  docId: DocId,
): boolean {
  return peerState.subscriptions.has(docId)
}

/**
 * Update peer's document awareness
 */
export function setPeerDocumentAwareness(
  peerState: PeerState,
  docId: DocId,
  awareness: "unknown" | "absent" | "pending",
): void
export function setPeerDocumentAwareness(
  peerState: PeerState,
  docId: DocId,
  awareness: "synced",
  version: VersionVector,
): void
export function setPeerDocumentAwareness(
  peerState: PeerState,
  docId: DocId,
  awareness: "unknown" | "synced" | "absent" | "pending",
  version?: VersionVector,
): void {
  const lastUpdated = new Date()
  if (awareness === "synced") {
    if (!version) {
      throw new Error("version is required when awareness is 'has-doc'")
    }
    peerState.docSyncStates.set(docId, {
      status: awareness,
      lastKnownVersion: version,
      lastUpdated,
    })
  } else {
    peerState.docSyncStates.set(docId, {
      status: awareness,
      lastUpdated,
    })
  }
}

/**
 * Get all channels connected to a peer
 *
 * This utility function returns all active channels for a given peer.
 * A peer may have multiple channels (e.g., reconnection scenarios, multiple
 * network transports).
 *
 * ## Use Cases
 *
 * - Sending messages to all channels of a specific peer
 * - Checking if a peer is currently connected
 * - Debugging connection state
 *
 * ## Example
 *
 * ```typescript
 * const channels = getChannelsForPeer(model, peerId)
 * if (channels.length > 0) {
 *   // Peer is connected via at least one channel
 * }
 * ```
 *
 * @param model - The synchronizer model
 * @param peerId - The peer ID to look up
 * @returns Array of connected channels for this peer (empty if peer not found)
 */
export function getChannelsForPeer(
  model: SynchronizerModel,
  peerId: PeerID,
): ConnectedChannel[] {
  const peerState = model.peers.get(peerId)
  if (!peerState) return []

  return Array.from(peerState.channels)
    .map(channelId => model.channels.get(channelId))
    .filter((ch): ch is ConnectedChannel => ch !== undefined)
}

/**
 * Get all peers that have a document
 *
 * This utility function returns all peers that have explicitly indicated they
 * have a copy of the specified document (awareness === "synced" or "pending").
 *
 * ## Use Cases
 *
 * - Finding which peers to request a document from
 * - Checking document availability across the network
 * - Implementing custom replication strategies
 * - Debugging document distribution
 *
 * ## Example
 *
 * ```typescript
 * const peers = getPeersWithDocument(model, "my-doc")
 * console.log(`Document available from ${peers.length} peers`)
 * ```
 *
 * @param model - The synchronizer model
 * @param docId - The document ID to look up
 * @returns Array of peer states that have this document
 */
export function getPeersWithDocument(
  model: SynchronizerModel,
  docId: DocId,
): PeerState[] {
  return Array.from(model.peers.values()).filter(peer => {
    const awareness = peer.docSyncStates.get(docId)
    return awareness?.status === "synced" || awareness?.status === "pending"
  })
}

/**
 * Check if we should sync with peer (based on version vectors)
 */
export function shouldSyncWithPeer(
  docState: DocState,
  peerAwareness: PeerDocSyncState | undefined,
): boolean {
  if (!peerAwareness) return true // Unknown, should sync
  if (peerAwareness.status === "unknown") return true // Unknown, should sync
  if (peerAwareness.status === "absent") return false // They don't have it
  if (peerAwareness.status === "pending") return true // They have it but we don't know their version, should sync

  // TypeScript now knows peerAwareness.awareness === "synced"
  // so lastKnownVersion is guaranteed to exist
  const ourVersion = docState.doc.version()
  const theirVersion = peerAwareness.lastKnownVersion

  const comparison = ourVersion.compare(theirVersion)

  // We should sync if we are ahead (1) OR if versions are concurrent (undefined)
  // Concurrent means we have changes they don't have, and they have changes we don't have
  return comparison === 1 || comparison === undefined
}
