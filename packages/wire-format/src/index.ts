/**
 * @loro-extended/wire-format
 *
 * Binary wire format encoding/decoding for loro-extended network adapters.
 *
 * This package provides a unified encoding layer for all network transports
 * (WebSocket, WebRTC, SSE, HTTP-Polling) with:
 *
 * - CBOR binary encoding (RFC 8949) via @levischuck/tiny-cbor
 * - 6-byte frame header with Uint32 payload length (supports up to 4GB)
 * - Compact field names for bandwidth efficiency
 * - Type-safe encoding/decoding with proper error handling
 *
 * @example
 * ```typescript
 * import { encodeFrame, decodeFrame, DecodeError } from "@loro-extended/wire-format"
 *
 * // Encode a message
 * const frame = encodeFrame({
 *   type: "channel/sync-request",
 *   docId: "my-doc",
 *   requesterDocVersion: versionVector,
 *   bidirectional: true,
 * })
 *
 * // Decode a message
 * try {
 *   const messages = decodeFrame(frame)
 *   for (const msg of messages) {
 *     console.log(msg.type)
 *   }
 * } catch (error) {
 *   if (error instanceof DecodeError) {
 *     console.error(`Decode failed: ${error.code} - ${error.message}`)
 *   }
 * }
 * ```
 */

// Constants
export {
  HEADER_SIZE,
  MessageType,
  TransmissionType,
  WIRE_VERSION,
  WireFlags,
} from "./constants.js"
// Decoding
export { decode, decodeFrame, fromWireFormat } from "./decode.js"

// Encoding
export {
  encode,
  encodeBatchFrame,
  encodeFrame,
  toWireFormat,
} from "./encode.js"
// Errors
export { DecodeError, type DecodeErrorCode } from "./errors.js"

// Wire types (for advanced use cases)
export type {
  WireBatch,
  WireDeleteRequest,
  WireDeleteResponse,
  WireDirectoryRequest,
  WireDirectoryResponse,
  WireEphemeral,
  WireEphemeralStore,
  WireEstablishRequest,
  WireEstablishResponse,
  WireMessage,
  WireNewDoc,
  WireSyncRequest,
  WireSyncResponse,
  WireTransmission,
  WireUpdate,
} from "./wire-types.js"
