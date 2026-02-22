/**
 * Encoding functions for wire format.
 *
 * Converts ChannelMsg types to compact wire format and CBOR binary.
 */

import { type CBORType, encodeCBOR } from "@levischuck/tiny-cbor"
import type {
  ChannelMsg,
  EphemeralStoreData,
  SyncTransmission,
} from "@loro-extended/repo"
import type { VersionVector } from "loro-crdt"
import {
  HEADER_SIZE,
  MessageType,
  TransmissionType,
  WIRE_VERSION,
  WireFlags,
} from "./constants.js"
import type {
  WireEphemeralStore,
  WireMessage,
  WireTransmission,
} from "./wire-types.js"

/**
 * Convert a plain object to a Map for CBOR encoding.
 * Recursively handles nested objects and arrays.
 */
function objectToMap(obj: unknown): CBORType {
  if (obj === null || obj === undefined) {
    return obj as CBORType
  }
  if (obj instanceof Uint8Array) {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(objectToMap)
  }
  if (typeof obj === "object") {
    const map = new Map<string | number, CBORType>()
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, objectToMap(value))
    }
    return map
  }
  return obj as CBORType
}

/**
 * Encode a VersionVector to Uint8Array for wire transmission.
 */
function encodeVersionVector(vv: VersionVector): Uint8Array {
  return vv.encode()
}

/**
 * Convert ephemeral store data to wire format.
 */
function toWireEphemeralStore(store: EphemeralStoreData): WireEphemeralStore {
  return {
    p: store.peerId,
    d: store.data,
    ns: store.namespace,
  }
}

/**
 * Convert sync transmission to wire format.
 */
function toWireTransmission(tx: SyncTransmission): WireTransmission {
  switch (tx.type) {
    case "up-to-date":
      return {
        k: TransmissionType.UpToDate,
        v: encodeVersionVector(tx.version),
      }
    case "snapshot":
      return {
        k: TransmissionType.Snapshot,
        d: tx.data,
        v: encodeVersionVector(tx.version),
      }
    case "update":
      return {
        k: TransmissionType.Update,
        d: tx.data,
        v: encodeVersionVector(tx.version),
      }
    case "unavailable":
      return { k: TransmissionType.Unavailable }
  }
}

/**
 * Convert a ChannelMsg to wire format.
 */
export function toWireFormat(msg: ChannelMsg): WireMessage {
  switch (msg.type) {
    case "channel/establish-request":
      return {
        t: MessageType.EstablishRequest,
        id: msg.identity.peerId,
        n: msg.identity.name,
        y: msg.identity.type,
      }

    case "channel/establish-response":
      return {
        t: MessageType.EstablishResponse,
        id: msg.identity.peerId,
        n: msg.identity.name,
        y: msg.identity.type,
      }

    case "channel/sync-request":
      return {
        t: MessageType.SyncRequest,
        doc: msg.docId,
        v: encodeVersionVector(msg.requesterDocVersion),
        e: msg.ephemeral?.map(toWireEphemeralStore),
        bi: msg.bidirectional,
      }

    case "channel/sync-response":
      return {
        t: MessageType.SyncResponse,
        doc: msg.docId,
        tx: toWireTransmission(msg.transmission),
        e: msg.ephemeral?.map(toWireEphemeralStore),
      }

    case "channel/update":
      return {
        t: MessageType.Update,
        doc: msg.docId,
        tx: toWireTransmission(msg.transmission),
      }

    case "channel/directory-request":
      return {
        t: MessageType.DirectoryRequest,
        docs: msg.docIds,
      }

    case "channel/directory-response":
      return {
        t: MessageType.DirectoryResponse,
        docs: msg.docIds,
      }

    case "channel/new-doc":
      return {
        t: MessageType.NewDoc,
        docs: msg.docIds,
      }

    case "channel/delete-request":
      return {
        t: MessageType.DeleteRequest,
        doc: msg.docId,
      }

    case "channel/delete-response":
      return {
        t: MessageType.DeleteResponse,
        doc: msg.docId,
        s: msg.status,
      }

    case "channel/ephemeral":
      return {
        t: MessageType.Ephemeral,
        doc: msg.docId,
        h: msg.hopsRemaining,
        st: msg.stores.map(toWireEphemeralStore),
      }

    case "channel/batch":
      return {
        t: MessageType.Batch,
        m: msg.messages.map(m => toWireFormat(m) as WireMessage),
      }
  }
}

/**
 * Encode a ChannelMsg to CBOR binary (without frame header).
 *
 * @param msg - The channel message to encode
 * @returns CBOR-encoded binary data
 */
export function encode(msg: ChannelMsg): Uint8Array {
  const wire = toWireFormat(msg)
  return encodeCBOR(objectToMap(wire))
}

/**
 * Encode a ChannelMsg to a binary frame with 6-byte header.
 *
 * Frame Structure (v2):
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ Header (6 bytes)                                                   │
 * ├──────────┬──────────┬──────────────────────────────────────────────┤
 * │ Version  │  Flags   │           Payload Length                     │
 * │ (1 byte) │ (1 byte) │           (4 bytes, big-endian)              │
 * ├──────────┴──────────┴──────────────────────────────────────────────┤
 * │                    Payload (CBOR encoded)                          │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * @param msg - The channel message to encode
 * @returns Binary frame with header + CBOR payload
 */
export function encodeFrame(msg: ChannelMsg): Uint8Array {
  const payload = encode(msg)

  // Create frame with 6-byte header
  const frame = new Uint8Array(HEADER_SIZE + payload.length)
  const view = new DataView(frame.buffer)

  // Header
  view.setUint8(0, WIRE_VERSION)
  view.setUint8(1, WireFlags.NONE)
  view.setUint32(2, payload.length, false) // big-endian, 4 bytes

  // Payload
  frame.set(payload, HEADER_SIZE)

  return frame
}

/**
 * Encode multiple ChannelMsgs as a batched frame.
 *
 * @param msgs - Array of channel messages to encode
 * @returns Binary frame with BATCH flag and array payload
 */
export function encodeBatchFrame(msgs: ChannelMsg[]): Uint8Array {
  const wireMessages = msgs.map(toWireFormat)
  const payload = encodeCBOR(objectToMap(wireMessages))

  // Create frame with 6-byte header
  const frame = new Uint8Array(HEADER_SIZE + payload.length)
  const view = new DataView(frame.buffer)

  // Header with BATCH flag
  view.setUint8(0, WIRE_VERSION)
  view.setUint8(1, WireFlags.BATCH)
  view.setUint32(2, payload.length, false) // big-endian, 4 bytes

  // Payload
  frame.set(payload, HEADER_SIZE)

  return frame
}
