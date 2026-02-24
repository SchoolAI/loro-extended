import {
  type Container,
  LoroDoc,
  type PeerID,
  type VersionVector,
} from "loro-crdt"
import type { ChannelMeta } from "./channel.js"

export type { PeerID } from "loro-crdt"

export type DocId = string
export type ChannelId = number
export type AdapterType = string
export type DocContent = Record<string, Container>

export type LoroDocMutator<T extends DocContent> = (doc: LoroDoc<T>) => void

export type PeerIdentityDetails = {
  peerId: PeerID // Globally unique, stable identifier (not generated per-connection)
  name?: string // Optional - peer can give itself a name; this is not unique
  type: "user" | "bot" | "service"
  // publicKey?: Uint8Array // Future: For cryptographic identity
}

export type ReadyStateChannelMeta = ChannelMeta & {
  state: "established" | "connected"
}

export type ReadyState = {
  docId: DocId
  identity: PeerIdentityDetails
  channels: ReadyStateChannelMeta[]
  status: "pending" | "synced" | "absent"
}

/**
 * Discriminated union for peer document awareness.
 * - "unknown": We don't know if the peer has this document
 * - "absent": Peer explicitly doesn't have this document
 * - "pending": Peer has this document but we don't know their version yet
 *   (e.g., they announced via new-doc but we haven't synced yet)
 * - "synced": Peer has this document with a known version
 */
export type PeerDocSyncState =
  | { status: "unknown"; lastUpdated: Date }
  | { status: "absent"; lastUpdated: Date }
  | { status: "pending"; lastUpdated: Date }
  | { status: "synced"; lastKnownVersion: VersionVector; lastUpdated: Date }

export type PeerState = {
  identity: PeerIdentityDetails
  docSyncStates: Map<DocId, PeerDocSyncState>
  subscriptions: Set<DocId>
  channels: Set<ChannelId>
}

/**
 * Pending network request waiting for storage to be consulted.
 */
export type PendingNetworkRequest = {
  channelId: ChannelId
  requesterDocVersion: VersionVector
  /** Whether the original sync-request was bidirectional (requires reciprocal sync-request) */
  bidirectional: boolean
}

export type DocState = {
  doc: LoroDoc
  docId: DocId

  /**
   * Storage channels we're waiting to hear from before responding to network requests.
   * When this set becomes empty, we process pendingNetworkRequests.
   *
   * - undefined or empty: No pending storage check
   * - non-empty: Waiting for these storage channels to respond
   */
  pendingStorageChannels?: Set<ChannelId>

  /**
   * Network sync-requests waiting for storage to be consulted.
   * When all storage channels have responded (pendingStorageChannels is empty),
   * we send sync-responses to all of these.
   */
  pendingNetworkRequests?: PendingNetworkRequest[]
}

/**
 * Creates a new DocState with a LoroDoc configured with the given peerId.
 *
 * The peerId is required to ensure proper UndoManager behavior and change attribution.
 * Each LoroDoc must have its peerId set to match the Repo's identity.peerId so that:
 * 1. UndoManager correctly identifies which changes belong to the local peer
 * 2. Changes are properly attributed in the oplog
 * 3. External tools that rely on PeerID matching work correctly
 *
 * @param docId - The document ID
 * @param peerId - The peer ID to set on the LoroDoc (must be a valid numeric string)
 */
export function createDocState({
  docId,
  peerId,
}: {
  docId: DocId
  peerId: PeerID
}): DocState {
  const doc = new LoroDoc()
  doc.setPeerId(peerId)
  return {
    doc,
    docId,
    // pendingStorageChannels and pendingNetworkRequests are undefined by default
    // They're only set when a network request arrives for an unknown doc with storage adapters
  }
}
