import type { LoroDoc } from "loro-crdt"
import type { ChannelKind } from "./channel.js"
import type { ChannelId, DocId, PeerID } from "./types.js"

/**
 * Context about the document being accessed.
 */
export type DocContext = {
  id: DocId
  doc: LoroDoc
}

/**
 * Context about the peer making the request.
 * Flat structure for ergonomic access (e.g., `peer.channelKind` not `peer.channel.kind`).
 */
export type PeerContext = {
  peerId: PeerID
  peerName?: string
  peerType: "user" | "bot" | "service"
  channelId: ChannelId
  channelKind: ChannelKind // "storage" | "network" | "other"
}

/**
 * Permissions control access to documents.
 *
 * Permissions are simple, synchronous predicates that determine what peers can do.
 * They run inside the synchronizer's TEA state machine.
 *
 * For advanced use cases (rate limiting, external auth, audit logging),
 * use middleware instead.
 *
 * @example
 * ```typescript
 * const repo = new Repo({
 *   permissions: {
 *     visibility: (doc, peer) => doc.id.startsWith('public/'),
 *     mutability: (doc, peer) => peer.peerType !== 'bot',
 *     deletion: (doc, peer) => peer.peerType === 'service',
 *   }
 * })
 * ```
 */
export interface Permissions {
  /**
   * Who can discover this document exists?
   *
   * Called when:
   * - Responding to directory-request
   * - Propagating new documents to peers
   * - Sending sync-request to channels
   *
   * BYPASS: Skipped if peer is already subscribed to the document.
   * Rationale: Once a peer knows about a doc, you can't "un-reveal" it.
   *
   * @default () => true (reveal all docs)
   */
  visibility(doc: DocContext, peer: PeerContext): boolean

  /**
   * Who can modify this document?
   *
   * Called when:
   * - Receiving sync-response with document data
   * - Receiving channel/update messages
   *
   * NO BYPASS: Always checked, even for subscribed peers.
   * Rationale: Write permissions can change over time.
   *
   * @default () => true (allow all updates)
   */
  mutability(doc: DocContext, peer: PeerContext): boolean

  /**
   * Who can create new documents?
   *
   * Called when:
   * - Peer sends sync-request for a document that doesn't exist locally
   *
   * NO BYPASS: Always checked.
   * Rationale: Creation is a one-time event, no subscription context.
   *
   * Note: Receives only docId (not DocContext) since the document doesn't exist yet.
   *
   * @default () => true (allow all creation)
   */
  creation(docId: DocId, peer: PeerContext): boolean

  /**
   * Who can delete documents?
   *
   * Called when:
   * - Receiving channel/delete-request
   * - Local deletion request
   *
   * NO BYPASS: Always checked.
   * Rationale: Deletion is destructive and must always be authorized.
   *
   * @default () => false (deny all deletion - safe default)
   */
  deletion(doc: DocContext, peer: PeerContext): boolean
}

/**
 * Default permissions: permissive for discovery and modification,
 * restrictive for deletion.
 */
const defaultPermissions: Permissions = {
  visibility: () => true,
  mutability: () => true,
  creation: () => true,
  deletion: () => false, // Safe default: deny deletion
}

/**
 * Create a Permissions object with defaults for any unspecified permissions.
 *
 * @param permissions - Partial permissions to override defaults
 * @returns Complete Permissions object
 *
 * @example
 * ```typescript
 * // Only override what you need
 * const permissions = createPermissions({
 *   visibility: (doc, peer) => doc.id.startsWith('public/'),
 * })
 * ```
 */
export function createPermissions(
  permissions: Partial<Permissions> = {},
): Permissions {
  return {
    visibility: permissions.visibility ?? defaultPermissions.visibility,
    mutability: permissions.mutability ?? defaultPermissions.mutability,
    creation: permissions.creation ?? defaultPermissions.creation,
    deletion: permissions.deletion ?? defaultPermissions.deletion,
  }
}
