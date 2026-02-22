// packages/repo/src/channel-serialization.ts

import { VersionVector } from "loro-crdt"
import type { BatchableMsg, ChannelMsg, SyncTransmission } from "./channel.js"
import type { PeerID } from "./types.js"

/**
 * JSON-serializable version of VersionVector
 */
export type VersionVectorJSON = Record<PeerID, number>

/**
 * JSON-serializable version of Uint8Array (base64 encoded)
 */
export type BinaryDataJSON = string

/**
 * JSON-serializable version of SyncTransmission
 */
export type SyncTransmissionJSON =
  | {
      type: "up-to-date"
      version: VersionVectorJSON
    }
  | {
      type: "snapshot"
      data: BinaryDataJSON
      version: VersionVectorJSON
    }
  | {
      type: "update"
      data: BinaryDataJSON
      version: VersionVectorJSON
    }
  | {
      type: "unavailable"
    }

/**
 * JSON-serializable version of EphemeralPeerData
 */
export type EphemeralPeerDataJSON = {
  peerId: PeerID
  data: BinaryDataJSON
  namespace: string
}

/**
 * JSON-serializable version of EphemeralStoreData
 */
export type EphemeralStoreDataJSON = {
  peerId: PeerID
  data: BinaryDataJSON
  namespace: string
}

/**
 * JSON-serializable versions of all channel messages
 */
export type ChannelMsgJSON =
  | {
      type: "channel/establish-request"
      identity: {
        peerId: PeerID
        name: string
      }
    }
  | {
      type: "channel/establish-response"
      identity: {
        peerId: PeerID
        name: string
      }
    }
  | {
      type: "channel/sync-request"
      docId: string
      requesterDocVersion: VersionVectorJSON
      ephemeral?: EphemeralPeerDataJSON[]
      bidirectional: boolean
    }
  | {
      type: "channel/sync-response"
      docId: string
      transmission: SyncTransmissionJSON
      ephemeral?: EphemeralPeerDataJSON[]
    }
  | {
      type: "channel/update"
      docId: string
      transmission: SyncTransmissionJSON
    }
  | {
      type: "channel/directory-request"
      docIds?: string[]
    }
  | {
      type: "channel/directory-response"
      docIds: string[]
    }
  | {
      type: "channel/new-doc"
      docIds: string[]
    }
  | {
      type: "channel/delete-request"
      docId: string
    }
  | {
      type: "channel/delete-response"
      docId: string
      status: "deleted" | "ignored"
    }
  | {
      type: "channel/ephemeral"
      docId: string
      hopsRemaining: number
      stores: EphemeralStoreDataJSON[]
    }
  | {
      type: "channel/batch"
      messages: BatchableMsgJSON[]
    }

/**
 * JSON-serializable version of BatchableMsg (all established messages except batch itself)
 */
export type BatchableMsgJSON = Exclude<
  ChannelMsgJSON,
  { type: "channel/batch" }
>

/**
 * Utility functions for serialization
 */

export function versionVectorToJSON(vv: VersionVector): VersionVectorJSON {
  const map = vv.toJSON()
  const obj: VersionVectorJSON = {}
  for (const [peer, counter] of map.entries()) {
    obj[peer] = counter
  }
  return obj
}

export function versionVectorFromJSON(json: VersionVectorJSON): VersionVector {
  const map = new Map<PeerID, number>(
    Object.entries(json) as [`${number}`, number][],
  )
  return VersionVector.parseJSON(map)
}

export function uint8ArrayToJSON(data: Uint8Array): BinaryDataJSON {
  // Convert to base64 for JSON serialization
  // Use chunked processing to avoid stack overflow with large arrays

  // For small arrays, use the simple approach
  if (data.length < 8192) {
    return btoa(String.fromCharCode(...data))
  }

  // For large arrays, process in chunks to avoid stack overflow
  const CHUNK_SIZE = 8192
  let binary = ""

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }

  return btoa(binary)
}

export function uint8ArrayFromJSON(json: BinaryDataJSON): Uint8Array {
  // Convert from base64
  const binary = atob(json)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Serialize a channel message to JSON-compatible format.
 *
 * @deprecated For binary transports (WebSocket, WebRTC, HTTP POST), use
 * `@loro-extended/wire-format` instead. This function is still used internally
 * for SSE EventSource (server→client) which requires text-based JSON encoding.
 */
export function serializeChannelMsg(msg: ChannelMsg): ChannelMsgJSON {
  switch (msg.type) {
    case "channel/establish-request":
    case "channel/establish-response":
    case "channel/directory-request":
    case "channel/directory-response":
    case "channel/new-doc":
    case "channel/delete-request":
    case "channel/delete-response":
      // These messages don't contain VersionVector or Uint8Array
      return msg as ChannelMsgJSON

    case "channel/sync-request": {
      const result: ChannelMsgJSON = {
        type: msg.type,
        docId: msg.docId,
        requesterDocVersion: versionVectorToJSON(msg.requesterDocVersion),
        bidirectional: msg.bidirectional,
      }
      if (msg.ephemeral && msg.ephemeral.length > 0) {
        result.ephemeral = msg.ephemeral.map(ep => ({
          peerId: ep.peerId,
          data: uint8ArrayToJSON(ep.data),
          namespace: ep.namespace,
        }))
      }
      return result
    }

    case "channel/sync-response": {
      const result: ChannelMsgJSON = {
        type: msg.type,
        docId: msg.docId,
        transmission: serializeSyncTransmission(msg.transmission),
      }
      if (msg.ephemeral && msg.ephemeral.length > 0) {
        result.ephemeral = msg.ephemeral.map(ep => ({
          peerId: ep.peerId,
          data: uint8ArrayToJSON(ep.data),
          namespace: ep.namespace,
        }))
      }
      return result
    }

    case "channel/update":
      return {
        ...msg,
        transmission: serializeSyncTransmission(msg.transmission),
      }

    case "channel/ephemeral":
      return {
        ...msg,
        stores: msg.stores.map(s => ({
          peerId: s.peerId,
          data: uint8ArrayToJSON(s.data),
          namespace: s.namespace,
        })),
      }

    case "channel/batch":
      return {
        type: "channel/batch",
        messages: msg.messages.map(
          m => serializeChannelMsg(m) as BatchableMsgJSON,
        ),
      }
  }
}

function serializeSyncTransmission(
  transmission: SyncTransmission,
): SyncTransmissionJSON {
  switch (transmission.type) {
    case "up-to-date":
      return {
        type: "up-to-date",
        version: versionVectorToJSON(transmission.version),
      }
    case "snapshot":
      return {
        type: "snapshot",
        data: uint8ArrayToJSON(transmission.data),
        version: versionVectorToJSON(transmission.version),
      }
    case "update":
      return {
        type: "update",
        data: uint8ArrayToJSON(transmission.data),
        version: versionVectorToJSON(transmission.version),
      }
    case "unavailable":
      return { type: "unavailable" }
  }
}

/**
 * Deserialize a JSON-compatible message back to channel message.
 *
 * @deprecated For binary transports (WebSocket, WebRTC, HTTP POST), use
 * `@loro-extended/wire-format` instead. This function is still used internally
 * for SSE EventSource (server→client) and HTTP-Polling GET responses which
 * use text-based JSON encoding.
 */
export function deserializeChannelMsg(json: ChannelMsgJSON): ChannelMsg {
  switch (json.type) {
    case "channel/establish-request":
    case "channel/establish-response":
    case "channel/directory-request":
    case "channel/directory-response":
    case "channel/new-doc":
    case "channel/delete-request":
    case "channel/delete-response":
      return json as ChannelMsg

    case "channel/sync-request": {
      const result: ChannelMsg = {
        type: json.type,
        docId: json.docId,
        requesterDocVersion: versionVectorFromJSON(json.requesterDocVersion),
        bidirectional: json.bidirectional,
      }
      if (json.ephemeral && json.ephemeral.length > 0) {
        result.ephemeral = json.ephemeral.map(ep => ({
          peerId: ep.peerId,
          data: uint8ArrayFromJSON(ep.data),
          namespace: ep.namespace,
        }))
      }
      return result
    }

    case "channel/sync-response": {
      const result: ChannelMsg = {
        type: json.type,
        docId: json.docId,
        transmission: deserializeSyncTransmission(json.transmission),
      }
      if (json.ephemeral && json.ephemeral.length > 0) {
        result.ephemeral = json.ephemeral.map(ep => ({
          peerId: ep.peerId,
          data: uint8ArrayFromJSON(ep.data),
          namespace: ep.namespace,
        }))
      }
      return result
    }

    case "channel/update":
      return {
        ...json,
        transmission: deserializeSyncTransmission(json.transmission),
      }

    case "channel/ephemeral":
      return {
        ...json,
        stores: json.stores.map(s => ({
          peerId: s.peerId,
          data: uint8ArrayFromJSON(s.data),
          namespace: s.namespace,
        })),
      }

    case "channel/batch":
      return {
        type: "channel/batch",
        messages: json.messages.map(
          m => deserializeChannelMsg(m) as BatchableMsg,
        ),
      }
  }
}

function deserializeSyncTransmission(
  json: SyncTransmissionJSON,
): SyncTransmission {
  switch (json.type) {
    case "up-to-date":
      return {
        type: "up-to-date",
        version: versionVectorFromJSON(json.version),
      }
    case "snapshot":
      return {
        type: "snapshot",
        data: uint8ArrayFromJSON(json.data),
        version: versionVectorFromJSON(json.version),
      }
    case "update":
      return {
        type: "update",
        data: uint8ArrayFromJSON(json.data),
        version: versionVectorFromJSON(json.version),
      }
    case "unavailable":
      return { type: "unavailable" }
  }
}
