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
 * - Transport-level fragmentation for large payloads
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
 *
 * @example Fragmentation
 * ```typescript
 * import {
 *   fragmentPayload,
 *   FragmentReassembler,
 *   wrapCompleteMessage,
 * } from "@loro-extended/wire-format"
 *
 * // Fragment a large payload
 * const maxSize = 200 * 1024 // 200KB per fragment
 * if (payload.length > maxSize) {
 *   const fragments = fragmentPayload(payload, maxSize)
 *   for (const fragment of fragments) {
 *     send(fragment)
 *   }
 * } else {
 *   send(wrapCompleteMessage(payload))
 * }
 *
 * // Reassemble on receive
 * const reassembler = new FragmentReassembler({ timeoutMs: 10000 })
 * const result = reassembler.receiveRaw(data)
 * if (result.status === "complete") {
 *   process(result.data)
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
// Fragmentation
export {
  BATCH_ID_SIZE,
  batchIdToKey,
  calculateFragmentationOverhead,
  createFragmentData,
  createFragmentHeader,
  FRAGMENT_DATA,
  FRAGMENT_DATA_MIN_SIZE,
  FRAGMENT_HEADER,
  FRAGMENT_HEADER_PAYLOAD_SIZE,
  FragmentParseError,
  FragmentReassembleError,
  fragmentPayload,
  generateBatchId,
  keyToBatchId,
  MESSAGE_COMPLETE,
  parseTransportPayload,
  reassembleFragments,
  shouldFragment,
  type TransportPayload,
  wrapCompleteMessage,
} from "./fragment.js"
// Reassembler
export {
  FragmentReassembler,
  type ReassembleError,
  type ReassembleResult,
  type ReassemblerConfig,
  type TimerAPI,
} from "./reassembler.js"
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
