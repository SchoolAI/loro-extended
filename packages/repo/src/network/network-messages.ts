import type { DocumentId, PeerId } from "src/types.js"

export type SyncTransmission =
  | {
      // An empty transmission, caused by a sync request--but the peer realized there is no new data to send in the sync response
      type: "up-to-date"
    }
  | {
      // If needed, a complete snapshot can be sent; this is typically unnecessary because "update" and "update-with-version" are more succinct
      type: "snapshot"
      data: Uint8Array
    }
  | {
      // Once peers are in sync, sending local updates without version is sufficient
      type: "update"
      data: Uint8Array
    }
  | {
      // If peers are establishing a "first sync", then passing version offers optimally small data packet exchange
      type: "update-with-version"
      version: Uint8Array
      data: Uint8Array
    }
  | {
      // A request to sync can be made to a peer, but that peer may decide not to respond (e.g. permissions), or have nothing to respond with
      // (e.g. documentId is not in storage)
      type: "unavailable"
    }

/**
 * BARE network message types
 *
 * These contain individual message type data, but no senderId nor targetIds.
 */

export type BareNetMsgDirectoryRequest = {
  type: "directory-request"
  documentIds?: DocumentId[]
}

export type BareNetMsgDirectoryResponse = {
  type: "directory-response"
  documentIds: DocumentId[]
}

export type BareNetMsgDeleteRequest = {
  type: "delete-request"
  documentId: DocumentId
}

export type BareNetMsgDeleteResponse = {
  type: "delete-response"
  documentId: DocumentId
  status: "deleted" | "ignored"
}

export type BareNetMsgSyncRequest = {
  type: "sync-request"
  documentId: DocumentId
}

export type BareNetMsgSyncResponse = {
  type: "sync-response"
  documentId: DocumentId
  transmission: SyncTransmission
  /**
   * Hop count to prevent infinite forwarding cascades.
   * 0 = original message, 1 = forwarded once, etc.
   * Messages with hopCount >= 1 should not be forwarded again.
   */
  hopCount: number
}

/**
 * ADDRESSED network message types
 *
 * These augment bare network messages with targetIds, giving the message addressable recipients.
 */

export type AddressedNetMsgBase = {
  targetIds: PeerId[]
}

// biome-ignore format: spacing
export type AddressedNetMsgDirectoryRequest =
  & AddressedNetMsgBase
  & BareNetMsgDirectoryRequest

// biome-ignore format: spacing
export type AddressedNetMsgDirectoryResponse =
  AddressedNetMsgBase &
  BareNetMsgDirectoryResponse

// biome-ignore format: spacing
export type AddressedNetMsgDeleteRequest =
  & AddressedNetMsgBase
  & BareNetMsgDeleteRequest

// biome-ignore format: spacing
export type AddressedNetMsgDeleteResponse =
  & AddressedNetMsgBase
  & BareNetMsgDeleteResponse

// biome-ignore format: spacing
export type AddressedNetMsgSyncRequest =
  & AddressedNetMsgBase
  & BareNetMsgSyncRequest

// biome-ignore format: spacing
export type AddressedNetMsgSyncResponse =
  & AddressedNetMsgBase
  & BareNetMsgSyncResponse

/**
 * REGULAR network message types
 *
 * These have everything an ADDRESSED message has, plus a senderId.
 */

/** Sent Messages include senderId */
export type NetMsgBase = {
  senderId: PeerId
}

// biome-ignore format: spacing
export type NetMsgDirectoryRequest =
  & NetMsgBase
  & AddressedNetMsgDirectoryRequest

// biome-ignore format: spacing
export type NetMsgDirectoryResponse =
  & NetMsgBase
  & AddressedNetMsgDirectoryResponse

// biome-ignore format: spacing
export type NetMsgDeleteRequest =
  & NetMsgBase
  & AddressedNetMsgDeleteRequest

// biome-ignore format: spacing
export type NetMsgDeleteResponse =
  & NetMsgBase
  & AddressedNetMsgDeleteResponse

// biome-ignore format: spacing
export type NetMsgSyncRequest =
  & NetMsgBase
  & AddressedNetMsgSyncRequest

// biome-ignore format: spacing
export type NetMsgSyncResponse =
  & NetMsgBase
  & AddressedNetMsgSyncResponse

/**
 * BARE, ADDRESSED, and REGULAR network message union types
 *
 * These are probably what you're looking for--a way to annotate the type of message.
 */

export type BareNetMsg =
  | BareNetMsgDirectoryRequest
  | BareNetMsgDirectoryResponse
  | BareNetMsgDeleteRequest
  | BareNetMsgDeleteResponse
  | BareNetMsgSyncRequest
  | BareNetMsgSyncResponse

export type AddressedNetMsg =
  | AddressedNetMsgDirectoryRequest
  | AddressedNetMsgDirectoryResponse
  | AddressedNetMsgDeleteRequest
  | AddressedNetMsgDeleteResponse
  | AddressedNetMsgSyncRequest
  | AddressedNetMsgSyncResponse

export type NetMsg =
  | NetMsgDirectoryRequest
  | NetMsgDirectoryResponse
  | NetMsgDeleteRequest
  | NetMsgDeleteResponse
  | NetMsgSyncRequest
  | NetMsgSyncResponse
