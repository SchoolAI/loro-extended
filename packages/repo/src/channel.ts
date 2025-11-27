import type { VersionVector } from "loro-crdt"
import type {
  AdapterId,
  ChannelId,
  DocId,
  PeerID,
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
      version: VersionVector
    }
  | {
      // A request to sync can be made to a peer, but that peer may decide not to respond (e.g. due to rules), or have nothing to respond with
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
  /**
   * Whether the receiver should send a reciprocal sync-request back.
   * Defaults to true if omitted.
   * Set to false to prevent infinite loops when sending reciprocal requests.
   */
  bidirectional?: boolean
}

export type ChannelMsgSyncResponse = {
  type: "channel/sync-response"
  docId: DocId
  transmission: SyncTransmission
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

export type ChannelMsgEphemeral = {
  type: "channel/ephemeral"
  docId: DocId
  hopsRemaining: number
  data: Uint8Array
}

export type AddressedEstablishmentEnvelope = {
  toChannelIds: ChannelId[]
  message: EstablishmentMsg
}
/**
 * A channel message wrapped in target channelIds to send the message to
 *
 * These augment bare network messages with targetIds, giving the message addressable recipients.
 */

export type AddressedEstablishedEnvelope = {
  toChannelIds: ChannelId[]
  message: EstablishedMsg
}

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

/**
 * Message type unions based on valid channel states
 */

/** Messages valid during the establishment phase (ConnectedChannel) */
export type EstablishmentMsg =
  | ChannelMsgEstablishRequest
  | ChannelMsgEstablishResponse

/** Messages valid after establishment is complete (Channel with peerId) */
export type EstablishedMsg =
  | ChannelMsgSyncRequest
  | ChannelMsgSyncResponse
  | ChannelMsgDirectoryRequest
  | ChannelMsgDirectoryResponse
  | ChannelMsgDeleteRequest
  | ChannelMsgDeleteResponse
  | ChannelMsgEphemeral

/** All channel messages */
export type ChannelMsg = EstablishmentMsg | EstablishedMsg

/**
 * Type predicate to check if a message is an establishment message.
 */
export function isEstablishmentMsg(msg: ChannelMsg): msg is EstablishmentMsg {
  return (
    msg.type === "channel/establish-request" ||
    msg.type === "channel/establish-response"
  )
}

/**
 * Type predicate to check if a message requires an established channel.
 */
export function isEstablishedMsg(msg: ChannelMsg): msg is EstablishedMsg {
  return !isEstablishmentMsg(msg)
}

/**
 * A `GeneratedChannel` is created by an adapter's generate() method.
 * It has metadata and actions but no connection to the synchronizer yet.
 *
 * biome-ignore format: left-align
 */
export type GeneratedChannel =
  & ChannelMeta
  & ChannelActions

/**
 * A `ConnectedChannel` is registered with the synchronizer and can send/receive messages.
 * It has a channelId and an onReceive handler.
 *
 * biome-ignore format: left-align
 */
export type ConnectedChannel =
  & GeneratedChannel
  & ChannelIdentity
  & {
      type: 'connected',

      /**
       * Receive handler for incoming messages.
       * Set by the Synchronizer when the channel is added.
       */
      onReceive: (msg: ChannelMsg) => void

      /**
       * Type-safe send for establishment phase messages.
       * Only establishment messages can be sent before the channel is established.
       */
      send: (msg: EstablishmentMsg) => void
    }

/**
 * A `Channel` is a ConnectedChannel that has completed the establish handshake
 * and knows which peer it's connected to.
 *
 * Examples of different kinds of channels:
 *   - storage: we need to send a request to a database to get a document out of storage
 *   - network: we need to send a request for a sync from a peer
 *
 * biome-ignore format: left-align
 */
export type EstablishedChannel =
  & GeneratedChannel
  & ChannelIdentity
  & {
      type: 'established'

      peerId: PeerID

      /**
       * Receive handler for incoming messages.
       * Set by the Synchronizer when the channel is added.
       */
      onReceive: (msg: ChannelMsg) => void

      /**
       * Type-safe send for established channel messages.
       * Only sync/directory/delete messages can be sent after establishment.
       */
      send: (msg: EstablishedMsg) => void
    }

export type Channel = ConnectedChannel | EstablishedChannel

/**
 * Type guard to check if a Channel has been established with a peer.
 */
export function isEstablished(channel: Channel): channel is EstablishedChannel {
  return channel.type === "established"
}

export type ChannelMeta = {
  kind: ChannelKind
  adapterId: AdapterId
}

export type ChannelIdentity = {
  channelId: ChannelId
}

export type ChannelActions = {
  /**
   * Generic send method for channel messages.
   *
   * ⚠️ WARNING: This method does not enforce type safety at compile time.
   * Prefer using `sendEstablishment()` or `sendEstablished()` for type-safe sends.
   *
   * This method is kept for internal use where the caller is responsible for
   * ensuring messages are sent to channels in the correct state.
   */
  send: (msg: ChannelMsg) => void
  stop: () => void
}

export type ChannelKind = "storage" | "network" | "other"

export type ReceiveFn = (msg: ChannelMsg) => void

/**
 * @deprecated Channels are now ready-on-creation, no lifecycle callbacks needed
 * A set of callbacks for the channel to report its lifecycle events
 * to the Synchronizer. This allows the Synchronizer to manage connection state.
 */
export interface ChannelLifecycle {
  /** The channel is now connected and ready to send messages. */
  onReady: () => void
  /** An error occurred in the channel. */
  onError: (error: Error) => void
  /** The channel has disconnected. */
  onDisconnect: () => void
}

export type GenerateFn<G> = (context: G) => GeneratedChannel
