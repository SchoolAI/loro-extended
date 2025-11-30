/**
 * Loro Syncing Protocol implementation.
 *
 * This module provides binary encoding/decoding for the Loro Syncing Protocol,
 * as well as translation between protocol messages and loro-extended channel messages.
 */

// Constants
export {
  JOIN_ERROR_CODE,
  MAGIC_BYTES,
  MAGIC_STRINGS,
  MESSAGE_TYPE,
  PERMISSION,
  UPDATE_ERROR_CODE,
} from "./constants.js"

// Types
export type {
  CrdtType,
  DocUpdate,
  JoinError,
  JoinErrorCode,
  JoinRequest,
  JoinResponseOk,
  Leave,
  MessageTypeCode,
  Permission,
  PermissionString,
  ProtocolMessage,
  UpdateError,
  UpdateErrorCode,
} from "./types.js"

export {
  isDocUpdate,
  isJoinError,
  isJoinRequest,
  isJoinResponseOk,
  isLeave,
  isUpdateError,
} from "./types.js"

// Encoding/Decoding
export { encodeMessage, encodeVarBytes, encodeVarString } from "./encoder.js"
export { decodeMessage, decodeVarBytes, decodeVarString } from "./decoder.js"

// LEB128 utilities
export { decodeULEB128, encodeULEB128, uleb128Size } from "./leb128.js"

// Translation layer
export {
  fromProtocolMessage,
  toProtocolMessages,
  translateEstablishRequest,
  translateJoinResponse,
} from "./translation.js"