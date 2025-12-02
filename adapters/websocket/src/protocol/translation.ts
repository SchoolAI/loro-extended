/**
 * Translation layer between loro-extended ChannelMsg and Loro Syncing Protocol messages.
 *
 * This module handles the conversion between the two message formats, allowing
 * the WebSocket adapter to speak the Loro Syncing Protocol while integrating
 * with the loro-extended synchronization system.
 */

import type {
  ChannelMsg,
  ChannelMsgEphemeral,
  ChannelMsgEstablishRequest,
  ChannelMsgEstablishResponse,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ChannelMsgUpdate,
  PeerIdentityDetails,
} from "@loro-extended/repo"
import { LoroDoc, VersionVector } from "loro-crdt"
import { MESSAGE_TYPE } from "./constants.js"
import type {
  CrdtType,
  DocUpdate,
  JoinRequest,
  JoinResponseOk,
  ProtocolMessage,
} from "./types.js"

/**
 * Context for translating messages, including room/doc mappings.
 */
export type TranslationContext = {
  /** Map of roomId to docId (usually 1:1) */
  roomToDoc: Map<string, string>
  /** Map of docId to roomId (usually 1:1) */
  docToRoom: Map<string, string>
}

/**
 * Create a new translation context.
 */
export function createTranslationContext(): TranslationContext {
  return {
    roomToDoc: new Map(),
    docToRoom: new Map(),
  }
}

/**
 * Register a room/doc mapping.
 */
export function registerRoom(
  ctx: TranslationContext,
  roomId: string,
  docId: string,
): void {
  ctx.roomToDoc.set(roomId, docId)
  ctx.docToRoom.set(docId, roomId)
}

/**
 * Get the docId for a roomId.
 */
export function getDocId(ctx: TranslationContext, roomId: string): string {
  return ctx.roomToDoc.get(roomId) ?? roomId
}

/**
 * Get the roomId for a docId.
 */
export function getRoomId(ctx: TranslationContext, docId: string): string {
  return ctx.docToRoom.get(docId) ?? docId
}

/**
 * Convert a loro-extended ChannelMsg to Loro Protocol messages.
 *
 * Some loro-extended messages may translate to multiple protocol messages
 * (e.g., a sync-request with multiple docs becomes multiple JoinRequests).
 *
 * @param msg The loro-extended channel message
 * @param ctx Translation context for room/doc mappings
 * @returns Array of protocol messages to send
 */
export function toProtocolMessages(
  msg: ChannelMsg,
  ctx: TranslationContext,
): ProtocolMessage[] {
  switch (msg.type) {
    case "channel/establish-request":
      // Establish requests don't directly map to protocol messages
      // They're handled at the connection level
      return []

    case "channel/establish-response":
      // Establish responses don't directly map to protocol messages
      // They're handled at the connection level
      return []

    case "channel/sync-request":
      return translateSyncRequest(msg, ctx)

    case "channel/sync-response":
      return translateSyncResponse(msg, ctx)

    case "channel/update":
      return translateUpdate(msg, ctx)

    case "channel/ephemeral":
      return translateEphemeral(msg, ctx)

    case "channel/directory-request":
    case "channel/directory-response":
    case "channel/new-doc":
    case "channel/delete-request":
    case "channel/delete-response":
      // These don't have direct protocol equivalents
      // They're handled at a higher level
      return []

    default:
      // Exhaustive check - this should never happen
      return []
  }
}

/**
 * Translate a sync-request to JoinRequest messages and optional ephemeral DocUpdate messages.
 * Returns an array of protocol messages (JoinRequests followed by ephemeral DocUpdates for each doc).
 */
function translateSyncRequest(
  msg: ChannelMsgSyncRequest,
  ctx: TranslationContext,
): ProtocolMessage[] {
  const result: ProtocolMessage[] = []

  for (const doc of msg.docs) {
    const roomId = getRoomId(ctx, doc.docId)
    // Register the mapping if not already registered
    registerRoom(ctx, roomId, doc.docId)

    // Add JoinRequest for this doc
    result.push({
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro" as CrdtType,
      roomId,
      // Use authPayload to carry bidirectional flag
      // [0] = bidirectional: false
      // [] = bidirectional: true (default)
      authPayload: msg.bidirectional
        ? new Uint8Array(0)
        : new Uint8Array([0]),
      requesterVersion: doc.requesterDocVersion.encode(),
    })

    // If this doc has ephemeral data, send it as a separate DocUpdate
    if (doc.ephemeral && doc.ephemeral.data.length > 0) {
      result.push({
        type: MESSAGE_TYPE.DocUpdate,
        crdtType: "ephemeral" as CrdtType,
        roomId,
        updates: [encodeEphemeralWithPeerId(doc.ephemeral.peerId, doc.ephemeral.data)],
      })
    }
  }

  return result
}

/**
 * Translate a sync-response to DocUpdate messages.
 * This also handles the ephemeral field, sending it as a separate DocUpdate
 * with crdtType: "ephemeral".
 */
function translateSyncResponse(
  msg: ChannelMsgSyncResponse,
  ctx: TranslationContext,
): DocUpdate[] {
  const roomId = getRoomId(ctx, msg.docId)
  const result: DocUpdate[] = []

  // Handle document data transmission
  switch (msg.transmission.type) {
    case "snapshot":
    case "update":
      result.push({
        type: MESSAGE_TYPE.DocUpdate,
        crdtType: "loro" as CrdtType,
        roomId,
        updates: [msg.transmission.data],
      })
      break

    case "up-to-date":
    case "unavailable":
      // No document data to send
      break
  }

  // Handle ephemeral data if present
  // This ensures presence data is transmitted along with sync-response
  if (msg.ephemeral && msg.ephemeral.length > 0) {
    const ephemeralUpdates = msg.ephemeral.map(store =>
      encodeEphemeralWithPeerId(store.peerId, store.data),
    )

    if (ephemeralUpdates.length > 0) {
      result.push({
        type: MESSAGE_TYPE.DocUpdate,
        crdtType: "ephemeral" as CrdtType,
        roomId,
        updates: ephemeralUpdates,
      })
    }
  }

  return result
}

/**
 * Translate an update message to DocUpdate.
 */
function translateUpdate(
  msg: ChannelMsgUpdate,
  ctx: TranslationContext,
): DocUpdate[] {
  const roomId = getRoomId(ctx, msg.docId)

  switch (msg.transmission.type) {
    case "snapshot":
    case "update":
      return [
        {
          type: MESSAGE_TYPE.DocUpdate,
          crdtType: "loro" as CrdtType,
          roomId,
          updates: [msg.transmission.data],
        },
      ]

    case "up-to-date":
    case "unavailable":
      return []

    default:
      return []
  }
}

/**
 * Encode a peerId and data into a single Uint8Array.
 * Format: [peerIdLength (2 bytes)] [peerId (UTF-8)] [data]
 */
function encodeEphemeralWithPeerId(peerId: string, data: Uint8Array): Uint8Array {
  const encoder = new TextEncoder()
  const peerIdBytes = encoder.encode(peerId)
  const result = new Uint8Array(2 + peerIdBytes.length + data.length)
  // Store peerId length as 2 bytes (big-endian)
  result[0] = (peerIdBytes.length >> 8) & 0xff
  result[1] = peerIdBytes.length & 0xff
  result.set(peerIdBytes, 2)
  result.set(data, 2 + peerIdBytes.length)
  return result
}

/**
 * Decode a peerId and data from a single Uint8Array.
 * Returns { peerId, data } or null if invalid.
 */
function decodeEphemeralWithPeerId(
  encoded: Uint8Array,
): { peerId: string; data: Uint8Array } | null {
  if (encoded.length < 2) return null
  const peerIdLength = (encoded[0] << 8) | encoded[1]
  if (encoded.length < 2 + peerIdLength) return null
  const decoder = new TextDecoder()
  const peerId = decoder.decode(encoded.slice(2, 2 + peerIdLength))
  const data = encoded.slice(2 + peerIdLength)
  return { peerId, data }
}

/**
 * Translate an ephemeral message to DocUpdate with ephemeral CRDT type.
 * The new format uses stores array with per-peer data.
 * We encode the peerId into each update so it survives the protocol translation.
 */
function translateEphemeral(
  msg: ChannelMsgEphemeral,
  ctx: TranslationContext,
): DocUpdate[] {
  const roomId = getRoomId(ctx, msg.docId)

  // Encode each store with its peerId so we can recover it on the other side
  const updates = msg.stores.map(store =>
    encodeEphemeralWithPeerId(store.peerId, store.data),
  )

  if (updates.length === 0) {
    return []
  }

  return [
    {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "ephemeral" as CrdtType,
      roomId,
      updates,
    },
  ]
}

/**
 * Result of translating a protocol message to loro-extended format.
 */
export type TranslatedMessage = {
  docId: string
  channelMsg: ChannelMsg
}

/**
 * Options for translating from protocol messages.
 */
export type FromProtocolOptions = {
  /** The peerId of the sender (for ephemeral messages) */
  senderPeerId?: string
}

/**
 * Convert a Loro Protocol message to loro-extended ChannelMsg.
 *
 * @param msg The protocol message
 * @param ctx Translation context for room/doc mappings
 * @param options Optional translation options
 * @returns The translated message with docId, or null if not translatable
 */
export function fromProtocolMessage(
  msg: ProtocolMessage,
  ctx: TranslationContext,
  options?: FromProtocolOptions,
): TranslatedMessage | null {
  switch (msg.type) {
    case MESSAGE_TYPE.JoinRequest:
      return translateJoinRequestToChannel(msg, ctx)

    case MESSAGE_TYPE.JoinResponseOk:
      return translateJoinResponseOkToChannel(msg, ctx)

    case MESSAGE_TYPE.DocUpdate:
      return translateDocUpdateToChannel(msg, ctx, options?.senderPeerId)

    case MESSAGE_TYPE.JoinError:
    case MESSAGE_TYPE.UpdateError:
    case MESSAGE_TYPE.Leave:
      // These are handled separately as errors/events
      return null
  }
}

/**
 * Translate a JoinRequest to a sync-request.
 */
function translateJoinRequestToChannel(
  msg: JoinRequest,
  ctx: TranslationContext,
): TranslatedMessage {
  const docId = getDocId(ctx, msg.roomId)
  registerRoom(ctx, msg.roomId, docId)

  const requesterDocVersion = VersionVector.decode(msg.requesterVersion)

  // Check authPayload for bidirectional flag
  // This is a hack to preserve the bidirectional flag through the Loro Protocol
  // which doesn't natively support it in JoinRequest.
  // [0] = bidirectional: false
  // [] = bidirectional: true (default)
  const bidirectional = msg.authPayload.length === 0 || msg.authPayload[0] !== 0

  const channelMsg: ChannelMsgSyncRequest = {
    type: "channel/sync-request",
    docs: [
      {
        docId,
        requesterDocVersion,
      },
    ],
    bidirectional,
  }

  return { docId, channelMsg }
}

/**
 * Translate a JoinResponseOk to a sync-response.
 */
function translateJoinResponseOkToChannel(
  msg: JoinResponseOk,
  ctx: TranslationContext,
): TranslatedMessage | null {
  const docId = getDocId(ctx, msg.roomId)

  // JoinResponseOk contains the receiver's version, not data
  // The actual data comes in subsequent DocUpdate messages
  // We can emit an "up-to-date" response if no data follows
  const receiverVersion = VersionVector.decode(msg.receiverVersion)

  const channelMsg: ChannelMsgSyncResponse = {
    type: "channel/sync-response",
    docId,
    transmission: {
      type: "up-to-date",
      version: receiverVersion,
    },
  }

  return { docId, channelMsg }
}

/**
 * Translate a DocUpdate to a sync-response or ephemeral message.
 */
function translateDocUpdateToChannel(
  msg: DocUpdate,
  ctx: TranslationContext,
  senderPeerId?: string,
): TranslatedMessage | null {
  const docId = getDocId(ctx, msg.roomId)

  if (msg.updates.length === 0) {
    return null
  }

  // Handle ephemeral messages
  if (msg.crdtType === "ephemeral" || msg.crdtType === "ephemeral-persisted") {
    // Decode each update to extract the peerId that was encoded when sending
    const stores = msg.updates
      .map(encoded => {
        const decoded = decodeEphemeralWithPeerId(encoded)
        if (!decoded) {
          // Fallback for old format or invalid data
          return {
            docId,
            peerId: (senderPeerId ?? "unknown") as `${number}`,
            data: encoded,
          }
        }
        return {
          docId,
          peerId: decoded.peerId as `${number}`,
          data: decoded.data,
        }
      })
      .filter(store => store.data.length > 0)

    if (stores.length === 0) {
      return null
    }

    const channelMsg: ChannelMsgEphemeral = {
      type: "channel/ephemeral",
      docId,
      hopsRemaining: 1, // Default hop count
      stores,
    }
    return { docId, channelMsg }
  }

  // For Loro documents, combine updates if multiple
  // In practice, we usually have one update per message
  const combinedData =
    msg.updates.length === 1
      ? msg.updates[0]
      : concatenateUint8Arrays(msg.updates)

  // We don't have version info in DocUpdate, so we create an update transmission
  // The version will be determined after import
  // Create an empty version vector using a temporary doc
  const tempDoc = new LoroDoc()
  const emptyVersion = tempDoc.version()

  const channelMsg: ChannelMsgSyncResponse = {
    type: "channel/sync-response",
    docId,
    transmission: {
      type: "update",
      data: combinedData,
      // Version will be filled in by the receiver after import
      version: emptyVersion,
    },
  }

  return { docId, channelMsg }
}

/**
 * Helper to concatenate multiple Uint8Arrays.
 */
function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/**
 * Translate an establish-request to JoinRequest messages for specified docs.
 *
 * This is used when a client connects and wants to sync specific documents.
 *
 * @param msg The establish request message
 * @param docIds The document IDs to join
 * @param getVersion Function to get the current version for a doc
 * @returns Array of JoinRequest messages
 */
export function translateEstablishRequest(
  _msg: ChannelMsgEstablishRequest,
  docIds: string[],
  getVersion: (docId: string) => VersionVector,
): JoinRequest[] {
  return docIds.map(docId => ({
    type: MESSAGE_TYPE.JoinRequest,
    crdtType: "loro" as CrdtType,
    roomId: docId, // Room ID = Doc ID
    authPayload: new Uint8Array(0),
    requesterVersion: getVersion(docId).encode(),
  }))
}

/**
 * Result of translating a JoinResponse.
 */
export type TranslatedJoinResponse = {
  establishResponse: ChannelMsgEstablishResponse
  syncResponse?: ChannelMsgSyncResponse
}

/**
 * Translate a JoinResponseOk to establish-response and optional sync-response.
 *
 * @param msg The JoinResponseOk message
 * @param identity The peer identity to include in the response
 * @returns The translated messages
 */
export function translateJoinResponse(
  msg: JoinResponseOk,
  identity: PeerIdentityDetails,
): TranslatedJoinResponse {
  const receiverVersion = VersionVector.decode(msg.receiverVersion)

  const establishResponse: ChannelMsgEstablishResponse = {
    type: "channel/establish-response",
    identity,
  }

  // Include sync response with version info
  const syncResponse: ChannelMsgSyncResponse = {
    type: "channel/sync-response",
    docId: msg.roomId,
    transmission: {
      type: "up-to-date",
      version: receiverVersion,
    },
  }

  return { establishResponse, syncResponse }
}
