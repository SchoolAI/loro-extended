import type { VersionVector } from "loro-crdt"
import type {
  AdapterId,
  ChannelId,
  DocId,
  PeerIdentityDetails,
} from "./types.js"

export type { ChannelId } from "./types.js"

export type SyncTransmission =
  | {
      // An empty transmission, caused by a sync request--but the peer realized there is no new data to send in the sync response
      type: "up-to-date"
      version: VersionVector
    }
  | {
      // If needed, a complete snapshot can be sent--e.g. on first sync
      type: "snapshot"
      data: Uint8Array
      version: VersionVector
    }
  | {
      // Once peers are in sync, sending updates is sufficient
      type: "update"
      data: Uint8Array
    }
  | {
      // A request to sync can be made to a peer, but that peer may decide not to respond (e.g. permissions), or have nothing to respond with
      // (e.g. docId is not in storage)
      type: "unavailable"
    }

/**
 * BARE network message types
 *
 * These contain individual message type data, but no senderId nor targetIds.
 */

export type ChannelMsgEstablishRequest = {
  type: "channel/establish-request"
  identity: PeerIdentityDetails
}

export type ChannelMsgEstablishResponse = {
  type: "channel/establish-response"
  identity: PeerIdentityDetails
}

export type ChannelMsgSyncRequest = {
  type: "channel/sync-request"
  docs: {
    docId: DocId
    requesterDocVersion: VersionVector
  }[]
}

export type ChannelMsgSyncResponse = {
  type: "channel/sync-response"
  docId: DocId
  transmission: SyncTransmission
  /**
   * Hop count to prevent infinite forwarding cascades.
   * 0 = original message, 1 = forwarded once, etc.
   * Messages with hopCount >= 1 should not be forwarded again.
   */
  hopCount: number
}

export type ChannelMsgDirectoryRequest = {
  type: "channel/directory-request"
  docIds?: DocId[]
}

export type ChannelMsgDirectoryResponse = {
  type: "channel/directory-response"
  docIds: DocId[]
}

export type ChannelMsgDeleteRequest = {
  type: "channel/delete-request"
  docId: DocId
}

export type ChannelMsgDeleteResponse = {
  type: "channel/delete-response"
  docId: DocId
  status: "deleted" | "ignored"
}

/**
 * A channel message wrapped in target channelIds to send the message to
 *
 * These augment bare network messages with targetIds, giving the message addressable recipients.
 */

export type AddressedEnvelope = {
  toChannelIds: ChannelId[]
  message: ChannelMsg
}

export type ReturnEnvelope = {
  fromChannelId: ChannelId
  message: ChannelMsg
}

/**
 * BARE, ADDRESSED, and REGULAR network message union types
 *
 * These are probably what you're looking for--a way to annotate the type of message.
 */

export type ChannelMsg =
  | ChannelMsgEstablishRequest
  | ChannelMsgEstablishResponse
  | ChannelMsgSyncRequest
  | ChannelMsgSyncResponse
  | ChannelMsgDirectoryRequest
  | ChannelMsgDirectoryResponse
  | ChannelMsgDeleteRequest
  | ChannelMsgDeleteResponse

/**
 * A `BaseChannel` is the base of each of our 2 Channel types. It can also be used as
 * as a primordial Channel that doesn't yet have a channelId.
 *
 * biome-ignore format: left-align
 */
export type BaseChannel =
  & ChannelMeta
  & ChannelActions

/**
 * A `Channel` is our side of a connection to an external representation of a document.
 *
 * Examples of different kinds of channels:
 *   - storage: we need to send a request to a database to get a document out of storage
 *   - network: we need to send a request for a sync from a peer
 *
 * biome-ignore format: left-align
 */
export type Channel =
  & BaseChannel
  & ChannelIdentity

export type ChannelIdentity = {
  channelId: ChannelId // ID used locally to this repo only
  peer:
    | { state: "unestablished" }
    | {
        state: "established"
        identity: PeerIdentityDetails
      }
}

export type ChannelMeta = {
  kind: ChannelKind
  adapterId: AdapterId
}

export type ChannelActions = {
  send: (msg: ChannelMsg) => void
  start: (receive: ReceiveFn) => void
  stop: () => void
}

export type ChannelKind = "storage" | "network" | "other"

export type ReceiveFn = (msg: ChannelMsg) => void

export type GenerateFn<G> = (context: G) => BaseChannel
