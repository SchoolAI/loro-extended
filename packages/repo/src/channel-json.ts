// packages/repo/src/channel-serialization.ts

import { VersionVector } from "loro-crdt"
import type { ChannelMsg, SyncTransmission } from "./channel.js"
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
      docs: {
        docId: string
        requesterDocVersion: VersionVectorJSON
      }[]
    }
  | {
      type: "channel/sync-response"
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
      data: BinaryDataJSON
    }

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
  return btoa(String.fromCharCode(...data))
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
 * Serialize a channel message to JSON-compatible format
 */
export function serializeChannelMsg(msg: ChannelMsg): ChannelMsgJSON {
  switch (msg.type) {
    case "channel/establish-request":
    case "channel/establish-response":
    case "channel/directory-request":
    case "channel/directory-response":
    case "channel/delete-request":
    case "channel/delete-response":
      // These messages don't contain VersionVector or Uint8Array
      return msg as ChannelMsgJSON

    case "channel/sync-request":
      return {
        ...msg,
        docs: msg.docs.map(doc => ({
          docId: doc.docId,
          requesterDocVersion: versionVectorToJSON(doc.requesterDocVersion),
        })),
      }

    case "channel/sync-response":
      return {
        ...msg,
        transmission: serializeSyncTransmission(msg.transmission),
      }

    case "channel/ephemeral":
      return {
        ...msg,
        data: uint8ArrayToJSON(msg.data),
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
 * Deserialize a JSON-compatible message back to channel message
 */
export function deserializeChannelMsg(json: ChannelMsgJSON): ChannelMsg {
  switch (json.type) {
    case "channel/establish-request":
    case "channel/establish-response":
    case "channel/directory-request":
    case "channel/directory-response":
    case "channel/delete-request":
    case "channel/delete-response":
      return json as ChannelMsg

    case "channel/sync-request":
      return {
        ...json,
        docs: json.docs.map(doc => ({
          docId: doc.docId,
          requesterDocVersion: versionVectorFromJSON(doc.requesterDocVersion),
        })),
      }

    case "channel/sync-response":
      return {
        ...json,
        transmission: deserializeSyncTransmission(json.transmission),
      }

    case "channel/ephemeral":
      return {
        ...json,
        data: uint8ArrayFromJSON(json.data),
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
