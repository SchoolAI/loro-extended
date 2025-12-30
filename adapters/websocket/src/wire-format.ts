/**
 * Wire format for native loro-extended WebSocket protocol.
 *
 * This module handles encoding/decoding of ChannelMsg types to/from
 * a binary wire format using CBOR (RFC 8949).
 *
 * Frame Structure:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Header (4 bytes)                                            │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Version (1) │ Flags (1) │ Payload Length (2, big-endian)    │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Payload (CBOR encoded)                                      │
 * └─────────────────────────────────────────────────────────────┘
 */

import { decodeCBOR, encodeCBOR, type CBORType } from "@levischuck/tiny-cbor"
import type {
  BatchableMsg,
  ChannelMsg,
  ChannelMsgBatch,
  ChannelMsgDeleteRequest,
  ChannelMsgDeleteResponse,
  ChannelMsgDirectoryRequest,
  ChannelMsgDirectoryResponse,
  ChannelMsgEphemeral,
  ChannelMsgEstablishRequest,
  ChannelMsgEstablishResponse,
  ChannelMsgNewDoc,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
  ChannelMsgUpdate,
  EphemeralStoreData,
  SyncTransmission,
} from "@loro-extended/repo"
import { type PeerID, VersionVector } from "loro-crdt"

/** Current wire protocol version */
export const WIRE_VERSION = 1

/** Wire format flags */
export const WireFlags = {
  NONE: 0x00,
  BATCH: 0x01, // Payload is array of messages
  COMPRESSED: 0x02, // Reserved for future compression support
} as const

/** Message type discriminators */
export const MessageType = {
  EstablishRequest: 0x01,
  EstablishResponse: 0x02,
  SyncRequest: 0x10,
  SyncResponse: 0x11,
  Update: 0x12,
  DirectoryRequest: 0x20,
  DirectoryResponse: 0x21,
  NewDoc: 0x22,
  DeleteRequest: 0x30,
  DeleteResponse: 0x31,
  Ephemeral: 0x40,
  Batch: 0x50,
} as const

/** Transmission type discriminators */
const TransmissionType = {
  UpToDate: 0x00,
  Snapshot: 0x01,
  Update: 0x02,
  Unavailable: 0x03,
} as const

/**
 * Wire message format - compact representation for network transmission.
 * Uses short field names and numeric type discriminators.
 *
 * Note: VersionVector is encoded as Uint8Array using VersionVector.encode()
 */
type WireMessage =
  | WireEstablishRequest
  | WireEstablishResponse
  | WireSyncRequest
  | WireSyncResponse
  | WireUpdate
  | WireDirectoryRequest
  | WireDirectoryResponse
  | WireNewDoc
  | WireDeleteRequest
  | WireDeleteResponse
  | WireEphemeral
  | WireBatch

type WireEstablishRequest = {
  t: typeof MessageType.EstablishRequest
  id: PeerID // identity.peerId
  n?: string // identity.name
  y: "user" | "bot" | "service" // identity.type
}

type WireEstablishResponse = {
  t: typeof MessageType.EstablishResponse
  id: PeerID
  n?: string
  y: "user" | "bot" | "service"
}

// VersionVector is encoded as Uint8Array on the wire
type WireTransmission =
  | { k: typeof TransmissionType.UpToDate; v: Uint8Array }
  | { k: typeof TransmissionType.Snapshot; d: Uint8Array; v: Uint8Array }
  | { k: typeof TransmissionType.Update; d: Uint8Array; v: Uint8Array }
  | { k: typeof TransmissionType.Unavailable }

type WireEphemeralStore = {
  p: PeerID // peerId
  d: Uint8Array // data
  ns: string // namespace
}

type WireSyncRequest = {
  t: typeof MessageType.SyncRequest
  doc: string // docId
  v: Uint8Array // requesterDocVersion (encoded)
  e?: WireEphemeralStore[] // ephemeral
  bi: boolean // bidirectional
}

type WireSyncResponse = {
  t: typeof MessageType.SyncResponse
  doc: string
  tx: WireTransmission // transmission
  e?: WireEphemeralStore[]
}

type WireUpdate = {
  t: typeof MessageType.Update
  doc: string
  tx: WireTransmission
}

type WireDirectoryRequest = {
  t: typeof MessageType.DirectoryRequest
  docs?: string[] // docIds
}

type WireDirectoryResponse = {
  t: typeof MessageType.DirectoryResponse
  docs: string[]
}

type WireNewDoc = {
  t: typeof MessageType.NewDoc
  docs: string[]
}

type WireDeleteRequest = {
  t: typeof MessageType.DeleteRequest
  doc: string
}

type WireDeleteResponse = {
  t: typeof MessageType.DeleteResponse
  doc: string
  s: "deleted" | "ignored" // status
}

type WireEphemeral = {
  t: typeof MessageType.Ephemeral
  doc: string
  h: number // hopsRemaining
  st: WireEphemeralStore[] // stores
}

type WireBatch = {
  t: typeof MessageType.Batch
  m: WireMessage[] // messages (excluding nested batches)
}

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
 * Convert a Map from CBOR decoding back to a plain object.
 * Recursively handles nested Maps and arrays.
 */
function mapToObject(value: CBORType): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {}
    for (const [key, val] of value.entries()) {
      obj[String(key)] = mapToObject(val)
    }
    return obj
  }
  if (Array.isArray(value)) {
    return value.map(mapToObject)
  }
  return value
}

/**
 * Encode a VersionVector to Uint8Array for wire transmission.
 */
function encodeVersionVector(vv: VersionVector): Uint8Array {
  return vv.encode()
}

/**
 * Decode a Uint8Array back to VersionVector.
 */
function decodeVersionVector(data: Uint8Array): VersionVector {
  return VersionVector.decode(data)
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
 * Convert wire format back to ChannelMsg.
 */
export function fromWireFormat(wire: WireMessage): ChannelMsg {
  switch (wire.t) {
    case MessageType.EstablishRequest:
      return {
        type: "channel/establish-request",
        identity: {
          peerId: wire.id,
          name: wire.n,
          type: wire.y,
        },
      } satisfies ChannelMsgEstablishRequest

    case MessageType.EstablishResponse:
      return {
        type: "channel/establish-response",
        identity: {
          peerId: wire.id,
          name: wire.n,
          type: wire.y,
        },
      } satisfies ChannelMsgEstablishResponse

    case MessageType.SyncRequest:
      return {
        type: "channel/sync-request",
        docId: wire.doc,
        requesterDocVersion: decodeVersionVector(wire.v),
        ephemeral: wire.e?.map(fromWireEphemeralStore),
        bidirectional: wire.bi,
      } satisfies ChannelMsgSyncRequest

    case MessageType.SyncResponse:
      return {
        type: "channel/sync-response",
        docId: wire.doc,
        transmission: fromWireTransmission(wire.tx),
        ephemeral: wire.e?.map(fromWireEphemeralStore),
      } satisfies ChannelMsgSyncResponse

    case MessageType.Update:
      return {
        type: "channel/update",
        docId: wire.doc,
        transmission: fromWireTransmission(wire.tx),
      } satisfies ChannelMsgUpdate

    case MessageType.DirectoryRequest:
      return {
        type: "channel/directory-request",
        docIds: wire.docs,
      } satisfies ChannelMsgDirectoryRequest

    case MessageType.DirectoryResponse:
      return {
        type: "channel/directory-response",
        docIds: wire.docs,
      } satisfies ChannelMsgDirectoryResponse

    case MessageType.NewDoc:
      return {
        type: "channel/new-doc",
        docIds: wire.docs,
      } satisfies ChannelMsgNewDoc

    case MessageType.DeleteRequest:
      return {
        type: "channel/delete-request",
        docId: wire.doc,
      } satisfies ChannelMsgDeleteRequest

    case MessageType.DeleteResponse:
      return {
        type: "channel/delete-response",
        docId: wire.doc,
        status: wire.s,
      } satisfies ChannelMsgDeleteResponse

    case MessageType.Ephemeral:
      return {
        type: "channel/ephemeral",
        docId: wire.doc,
        hopsRemaining: wire.h,
        stores: wire.st.map(fromWireEphemeralStore),
      } satisfies ChannelMsgEphemeral

    case MessageType.Batch:
      return {
        type: "channel/batch",
        messages: wire.m.map(m => fromWireFormat(m) as BatchableMsg),
      } satisfies ChannelMsgBatch

    default:
      throw new Error(`Unknown wire message type: ${(wire as WireMessage).t}`)
  }
}

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

function fromWireTransmission(wire: WireTransmission): SyncTransmission {
  switch (wire.k) {
    case TransmissionType.UpToDate:
      return { type: "up-to-date", version: decodeVersionVector(wire.v) }
    case TransmissionType.Snapshot:
      return {
        type: "snapshot",
        data: wire.d,
        version: decodeVersionVector(wire.v),
      }
    case TransmissionType.Update:
      return {
        type: "update",
        data: wire.d,
        version: decodeVersionVector(wire.v),
      }
    case TransmissionType.Unavailable:
      return { type: "unavailable" }
  }
}

function toWireEphemeralStore(store: EphemeralStoreData): WireEphemeralStore {
  return {
    p: store.peerId,
    d: store.data,
    ns: store.namespace,
  }
}

function fromWireEphemeralStore(wire: WireEphemeralStore): EphemeralStoreData {
  return {
    peerId: wire.p,
    data: wire.d,
    namespace: wire.ns,
  }
}

/**
 * Encode a ChannelMsg to a binary frame.
 */
export function encodeFrame(msg: ChannelMsg): Uint8Array {
  const wire = toWireFormat(msg)
  const payload = encodeCBOR(objectToMap(wire))

  // Create frame with header
  const frame = new Uint8Array(4 + payload.length)
  const view = new DataView(frame.buffer)

  // Header
  view.setUint8(0, WIRE_VERSION)
  view.setUint8(1, WireFlags.NONE)
  view.setUint16(2, payload.length, false) // big-endian

  // Payload
  frame.set(payload, 4)

  return frame
}

/**
 * Encode multiple ChannelMsgs as a batched frame.
 */
export function encodeBatchFrame(msgs: ChannelMsg[]): Uint8Array {
  const wireMessages = msgs.map(toWireFormat)
  const payload = encodeCBOR(objectToMap(wireMessages))

  // Create frame with header
  const frame = new Uint8Array(4 + payload.length)
  const view = new DataView(frame.buffer)

  // Header
  view.setUint8(0, WIRE_VERSION)
  view.setUint8(1, WireFlags.BATCH)
  view.setUint16(2, payload.length, false) // big-endian

  // Payload
  frame.set(payload, 4)

  return frame
}

/**
 * Decode a binary frame to ChannelMsg(s).
 * Returns an array because the frame might be a batch.
 */
export function decodeFrame(frame: Uint8Array): ChannelMsg[] {
  if (frame.length < 4) {
    throw new Error("Frame too short: missing header")
  }

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)

  const version = view.getUint8(0)
  if (version !== WIRE_VERSION) {
    throw new Error(`Unsupported wire version: ${version}`)
  }

  const flags = view.getUint8(1)
  const payloadLength = view.getUint16(2, false) // big-endian

  if (frame.length < 4 + payloadLength) {
    throw new Error(
      `Frame truncated: expected ${4 + payloadLength} bytes, got ${frame.length}`,
    )
  }

  const payload = frame.slice(4, 4 + payloadLength)
  const decoded = decodeCBOR(payload)

  if (flags & WireFlags.BATCH) {
    // Batch frame - decode array of wire messages
    const wireMessages = mapToObject(decoded) as WireMessage[]
    return wireMessages.map(fromWireFormat)
  }
  // Single message frame
  const wire = mapToObject(decoded) as WireMessage
  return [fromWireFormat(wire)]
}
