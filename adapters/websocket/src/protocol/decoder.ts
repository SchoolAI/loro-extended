/**
 * Binary message decoding for the Loro Syncing Protocol.
 */

import {
  JOIN_ERROR_CODE,
  MAGIC_STRINGS,
  MESSAGE_TYPE,
  PERMISSION,
  textDecoder,
  UPDATE_ERROR_CODE,
} from "./constants.js"
import { decodeULEB128 } from "./leb128.js"
import type {
  CrdtType,
  DocUpdate,
  JoinError,
  JoinErrorCode,
  JoinRequest,
  JoinResponseOk,
  Leave,
  ProtocolMessage,
  UpdateError,
  UpdateErrorCode,
} from "./types.js"

/**
 * Decode a variable-length string from a buffer.
 * @returns A tuple of [decoded string, new offset]
 */
export function decodeVarString(
  data: Uint8Array,
  offset: number,
): [string, number] {
  const [length, newOffset] = decodeULEB128(data, offset)
  const stringBytes = data.slice(newOffset, newOffset + length)
  const str = textDecoder.decode(stringBytes)
  return [str, newOffset + length]
}

/**
 * Decode variable-length bytes from a buffer.
 * @returns A tuple of [decoded bytes, new offset]
 */
export function decodeVarBytes(
  data: Uint8Array,
  offset: number,
): [Uint8Array, number] {
  const [length, newOffset] = decodeULEB128(data, offset)
  const bytes = data.slice(newOffset, newOffset + length)
  return [bytes, newOffset + length]
}

/**
 * Parse the magic bytes to determine the CRDT type.
 */
function parseMagicBytes(data: Uint8Array): CrdtType {
  const magic = textDecoder.decode(data.slice(0, 4))

  switch (magic) {
    case MAGIC_STRINGS.loro:
      return "loro"
    case MAGIC_STRINGS.ephemeral:
      return "ephemeral"
    case MAGIC_STRINGS.ephemeralPersisted:
      return "ephemeral-persisted"
    default:
      throw new Error(`Unknown magic bytes: ${magic}`)
  }
}

/**
 * Decode a protocol message from binary format.
 */
export function decodeMessage(data: Uint8Array): ProtocolMessage {
  if (data.length < 5) {
    throw new Error("Message too short: must be at least 5 bytes")
  }

  const crdtType = parseMagicBytes(data)
  const messageType = data[4]
  let offset = 5

  switch (messageType) {
    case MESSAGE_TYPE.JoinRequest: {
      const [roomId, offset1] = decodeVarString(data, offset)
      const [authPayload, offset2] = decodeVarBytes(data, offset1)
      const [requesterVersion, _offset3] = decodeVarBytes(data, offset2)

      return {
        type: MESSAGE_TYPE.JoinRequest,
        crdtType,
        roomId,
        authPayload,
        requesterVersion,
      } satisfies JoinRequest
    }

    case MESSAGE_TYPE.JoinResponseOk: {
      const [roomId, offset1] = decodeVarString(data, offset)
      const permissionByte = data[offset1]
      const permission = permissionByte === PERMISSION.Write ? "write" : "read"
      const [receiverVersion, offset3] = decodeVarBytes(data, offset1 + 1)
      const [metadata, _offset4] = decodeVarBytes(data, offset3)

      return {
        type: MESSAGE_TYPE.JoinResponseOk,
        crdtType,
        roomId,
        permission,
        receiverVersion,
        metadata,
      } satisfies JoinResponseOk
    }

    case MESSAGE_TYPE.JoinError: {
      const [roomId, offset1] = decodeVarString(data, offset)
      const code = data[offset1] as JoinErrorCode
      const [message, offset3] = decodeVarString(data, offset1 + 1)

      const result: JoinError = {
        type: MESSAGE_TYPE.JoinError,
        crdtType,
        roomId,
        code,
        message,
      }

      // Check for optional fields based on error code
      if (code === JOIN_ERROR_CODE.VersionUnknown && offset3 < data.length) {
        const [receiverVersion, offset4] = decodeVarBytes(data, offset3)
        result.receiverVersion = receiverVersion
        offset = offset4
      } else if (code === JOIN_ERROR_CODE.AppError && offset3 < data.length) {
        const [appCode, _offset4] = decodeULEB128(data, offset3)
        result.appCode = appCode
      }

      return result
    }

    case MESSAGE_TYPE.DocUpdate: {
      const [roomId, offset1] = decodeVarString(data, offset)
      const [numUpdates, offset2] = decodeULEB128(data, offset1)

      const updates: Uint8Array[] = []
      let currentOffset = offset2

      for (let i = 0; i < numUpdates; i++) {
        const [update, newOffset] = decodeVarBytes(data, currentOffset)
        updates.push(update)
        currentOffset = newOffset
      }

      return {
        type: MESSAGE_TYPE.DocUpdate,
        crdtType,
        roomId,
        updates,
      } satisfies DocUpdate
    }

    case MESSAGE_TYPE.UpdateError: {
      const [roomId, offset1] = decodeVarString(data, offset)
      const code = data[offset1] as UpdateErrorCode
      const [message, offset3] = decodeVarString(data, offset1 + 1)

      const result: UpdateError = {
        type: MESSAGE_TYPE.UpdateError,
        crdtType,
        roomId,
        code,
        message,
      }

      // Check for optional app code
      if (code === UPDATE_ERROR_CODE.AppError && offset3 < data.length) {
        const [appCode, _offset4] = decodeULEB128(data, offset3)
        result.appCode = appCode
      }

      return result
    }

    case MESSAGE_TYPE.Leave: {
      const [roomId, _offset1] = decodeVarString(data, offset)

      return {
        type: MESSAGE_TYPE.Leave,
        crdtType,
        roomId,
      } satisfies Leave
    }

    default:
      throw new Error(`Unknown message type: 0x${messageType.toString(16)}`)
  }
}
