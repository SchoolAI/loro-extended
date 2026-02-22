/**
 * Decoding functions for wire format.
 *
 * Converts CBOR binary back to ChannelMsg types.
 */

import { type CBORType, decodeCBOR } from "@levischuck/tiny-cbor"
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
import { VersionVector } from "loro-crdt"
import {
  HEADER_SIZE,
  MessageType,
  TransmissionType,
  WIRE_VERSION,
  WireFlags,
} from "./constants.js"
import { DecodeError } from "./errors.js"
import type {
  WireEphemeralStore,
  WireMessage,
  WireTransmission,
} from "./wire-types.js"

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
 * Decode a Uint8Array back to VersionVector.
 */
function decodeVersionVector(data: Uint8Array): VersionVector {
  return VersionVector.decode(data)
}

/**
 * Convert wire ephemeral store back to domain type.
 */
function fromWireEphemeralStore(wire: WireEphemeralStore): EphemeralStoreData {
  return {
    peerId: wire.p,
    data: wire.d,
    namespace: wire.ns,
  }
}

/**
 * Convert wire transmission back to domain type.
 */
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
      throw new DecodeError(
        "invalid_type",
        `Unknown wire message type: ${(wire as WireMessage).t}`,
      )
  }
}

/**
 * Normalize a Uint8Array subclass (like Buffer) to a plain Uint8Array.
 *
 * The @levischuck/tiny-cbor library performs strict prototype checks and
 * only accepts plain Uint8Array or DataView, not subclasses like Buffer.
 * This function ensures compatibility with Bun and Node.js WebSocket
 * implementations that may return Buffer instances.
 */
function normalizeUint8Array(data: Uint8Array): Uint8Array {
  // If it's already a plain Uint8Array, return as-is
  if (data.constructor === Uint8Array) {
    return data
  }
  // Otherwise, create a new plain Uint8Array from the data
  return new Uint8Array(data)
}

/**
 * Decode CBOR binary to ChannelMsg (without frame header).
 *
 * @param data - CBOR-encoded binary data
 * @returns The decoded channel message
 * @throws DecodeError if decoding fails
 */
export function decode(data: Uint8Array): ChannelMsg {
  const normalized = normalizeUint8Array(data)

  try {
    const decoded = decodeCBOR(normalized)
    const wire = mapToObject(decoded) as WireMessage
    return fromWireFormat(wire)
  } catch (error) {
    if (error instanceof DecodeError) {
      throw error
    }
    throw new DecodeError(
      "invalid_cbor",
      `Failed to decode CBOR: ${error instanceof Error ? error.message : String(error)}`,
      error,
    )
  }
}

/**
 * Decode a binary frame to ChannelMsg(s).
 *
 * Returns an array because the frame might be a batch.
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
 * @param frame - Binary frame with header + CBOR payload
 * @returns Array of decoded channel messages
 * @throws DecodeError if decoding fails
 */
export function decodeFrame(frame: Uint8Array): ChannelMsg[] {
  // Normalize input to plain Uint8Array (handles Buffer subclass from Bun/Node)
  const normalizedFrame = normalizeUint8Array(frame)

  if (normalizedFrame.length < HEADER_SIZE) {
    throw new DecodeError(
      "truncated_frame",
      `Frame too short: expected at least ${HEADER_SIZE} bytes, got ${normalizedFrame.length}`,
    )
  }

  const view = new DataView(
    normalizedFrame.buffer,
    normalizedFrame.byteOffset,
    normalizedFrame.byteLength,
  )

  const version = view.getUint8(0)
  if (version !== WIRE_VERSION) {
    throw new DecodeError(
      "unsupported_version",
      `Unsupported wire version: ${version} (expected ${WIRE_VERSION})`,
    )
  }

  const flags = view.getUint8(1)
  const payloadLength = view.getUint32(2, false) // big-endian, 4 bytes

  if (normalizedFrame.length < HEADER_SIZE + payloadLength) {
    throw new DecodeError(
      "truncated_frame",
      `Frame truncated: expected ${HEADER_SIZE + payloadLength} bytes, got ${normalizedFrame.length}`,
    )
  }

  const payload = normalizedFrame.slice(
    HEADER_SIZE,
    HEADER_SIZE + payloadLength,
  )

  try {
    const decoded = decodeCBOR(payload)

    if (flags & WireFlags.BATCH) {
      // Batch frame - decode array of wire messages
      const wireMessages = mapToObject(decoded) as WireMessage[]
      return wireMessages.map(fromWireFormat)
    }

    // Single message frame
    const wire = mapToObject(decoded) as WireMessage
    return [fromWireFormat(wire)]
  } catch (error) {
    if (error instanceof DecodeError) {
      throw error
    }
    throw new DecodeError(
      "invalid_cbor",
      `Failed to decode CBOR payload: ${error instanceof Error ? error.message : String(error)}`,
      error,
    )
  }
}
