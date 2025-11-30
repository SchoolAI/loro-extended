/**
 * Binary message encoding for the Loro Syncing Protocol.
 */

import {
  JOIN_ERROR_CODE,
  MAGIC_BYTES,
  MESSAGE_TYPE,
  PERMISSION,
  textEncoder,
  UPDATE_ERROR_CODE,
} from "./constants.js"
import { encodeULEB128, uleb128Size } from "./leb128.js"
import type { CrdtType, ProtocolMessage } from "./types.js"

/**
 * Get the magic bytes for a CRDT type.
 */
function getMagicBytes(crdtType: CrdtType): Uint8Array {
  switch (crdtType) {
    case "loro":
      return MAGIC_BYTES.loro
    case "ephemeral":
      return MAGIC_BYTES.ephemeral
    case "ephemeral-persisted":
      return MAGIC_BYTES.ephemeralPersisted
  }
}

/**
 * Encode a variable-length string (length-prefixed with ULEB128).
 */
export function encodeVarString(str: string): Uint8Array {
  const bytes = textEncoder.encode(str)
  const lengthBytes = encodeULEB128(bytes.length)
  const result = new Uint8Array(lengthBytes.length + bytes.length)
  result.set(lengthBytes, 0)
  result.set(bytes, lengthBytes.length)
  return result
}

/**
 * Encode variable-length bytes (length-prefixed with ULEB128).
 */
export function encodeVarBytes(data: Uint8Array): Uint8Array {
  const lengthBytes = encodeULEB128(data.length)
  const result = new Uint8Array(lengthBytes.length + data.length)
  result.set(lengthBytes, 0)
  result.set(data, lengthBytes.length)
  return result
}

/**
 * Calculate the total size needed for a protocol message.
 */
function calculateMessageSize(msg: ProtocolMessage): number {
  // Magic bytes (4) + message type (1)
  let size = 5

  switch (msg.type) {
    case MESSAGE_TYPE.JoinRequest: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      size += uleb128Size(msg.authPayload.length) + msg.authPayload.length
      size += uleb128Size(msg.requesterVersion.length) + msg.requesterVersion.length
      break
    }

    case MESSAGE_TYPE.JoinResponseOk: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      size += 1 // permission byte
      size += uleb128Size(msg.receiverVersion.length) + msg.receiverVersion.length
      size += uleb128Size(msg.metadata.length) + msg.metadata.length
      break
    }

    case MESSAGE_TYPE.JoinError: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const messageBytes = textEncoder.encode(msg.message)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      size += 1 // error code
      size += uleb128Size(messageBytes.length) + messageBytes.length
      if (msg.code === JOIN_ERROR_CODE.VersionUnknown && msg.receiverVersion) {
        size += uleb128Size(msg.receiverVersion.length) + msg.receiverVersion.length
      }
      if (msg.code === JOIN_ERROR_CODE.AppError && msg.appCode !== undefined) {
        size += uleb128Size(msg.appCode)
      }
      break
    }

    case MESSAGE_TYPE.DocUpdate: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      size += uleb128Size(msg.updates.length) // number of updates
      for (const update of msg.updates) {
        size += uleb128Size(update.length) + update.length
      }
      break
    }

    case MESSAGE_TYPE.UpdateError: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const messageBytes = textEncoder.encode(msg.message)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      size += 1 // error code
      size += uleb128Size(messageBytes.length) + messageBytes.length
      if (msg.code === UPDATE_ERROR_CODE.AppError && msg.appCode !== undefined) {
        size += uleb128Size(msg.appCode)
      }
      break
    }

    case MESSAGE_TYPE.Leave: {
      const roomIdBytes = textEncoder.encode(msg.roomId)
      size += uleb128Size(roomIdBytes.length) + roomIdBytes.length
      break
    }
  }

  return size
}

/**
 * Encode a protocol message to binary format.
 */
export function encodeMessage(msg: ProtocolMessage): Uint8Array {
  const size = calculateMessageSize(msg)
  const buffer = new Uint8Array(size)
  let offset = 0

  // Write magic bytes
  const magicBytes = getMagicBytes(msg.crdtType)
  buffer.set(magicBytes, offset)
  offset += 4

  // Write message type
  buffer[offset] = msg.type
  offset++

  switch (msg.type) {
    case MESSAGE_TYPE.JoinRequest: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length

      // Auth payload
      const authLen = encodeULEB128(msg.authPayload.length)
      buffer.set(authLen, offset)
      offset += authLen.length
      buffer.set(msg.authPayload, offset)
      offset += msg.authPayload.length

      // Requester version
      const versionLen = encodeULEB128(msg.requesterVersion.length)
      buffer.set(versionLen, offset)
      offset += versionLen.length
      buffer.set(msg.requesterVersion, offset)
      offset += msg.requesterVersion.length
      break
    }

    case MESSAGE_TYPE.JoinResponseOk: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length

      // Permission
      buffer[offset] = msg.permission === "write" ? PERMISSION.Write : PERMISSION.Read
      offset++

      // Receiver version
      const versionLen = encodeULEB128(msg.receiverVersion.length)
      buffer.set(versionLen, offset)
      offset += versionLen.length
      buffer.set(msg.receiverVersion, offset)
      offset += msg.receiverVersion.length

      // Metadata
      const metadataLen = encodeULEB128(msg.metadata.length)
      buffer.set(metadataLen, offset)
      offset += metadataLen.length
      buffer.set(msg.metadata, offset)
      offset += msg.metadata.length
      break
    }

    case MESSAGE_TYPE.JoinError: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length

      // Error code
      buffer[offset] = msg.code
      offset++

      // Error message
      const messageBytes = textEncoder.encode(msg.message)
      const messageLen = encodeULEB128(messageBytes.length)
      buffer.set(messageLen, offset)
      offset += messageLen.length
      buffer.set(messageBytes, offset)
      offset += messageBytes.length

      // Receiver version (only for VersionUnknown)
      if (msg.code === JOIN_ERROR_CODE.VersionUnknown && msg.receiverVersion) {
        const versionLen = encodeULEB128(msg.receiverVersion.length)
        buffer.set(versionLen, offset)
        offset += versionLen.length
        buffer.set(msg.receiverVersion, offset)
        offset += msg.receiverVersion.length
      }

      // App code (only for AppError)
      if (msg.code === JOIN_ERROR_CODE.AppError && msg.appCode !== undefined) {
        const appCodeBytes = encodeULEB128(msg.appCode)
        buffer.set(appCodeBytes, offset)
        offset += appCodeBytes.length
      }
      break
    }

    case MESSAGE_TYPE.DocUpdate: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length

      // Number of updates
      const numUpdates = encodeULEB128(msg.updates.length)
      buffer.set(numUpdates, offset)
      offset += numUpdates.length

      // Each update
      for (const update of msg.updates) {
        const updateLen = encodeULEB128(update.length)
        buffer.set(updateLen, offset)
        offset += updateLen.length
        buffer.set(update, offset)
        offset += update.length
      }
      break
    }

    case MESSAGE_TYPE.UpdateError: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length

      // Error code
      buffer[offset] = msg.code
      offset++

      // Error message
      const messageBytes = textEncoder.encode(msg.message)
      const messageLen = encodeULEB128(messageBytes.length)
      buffer.set(messageLen, offset)
      offset += messageLen.length
      buffer.set(messageBytes, offset)
      offset += messageBytes.length

      // App code (only for AppError)
      if (msg.code === UPDATE_ERROR_CODE.AppError && msg.appCode !== undefined) {
        const appCodeBytes = encodeULEB128(msg.appCode)
        buffer.set(appCodeBytes, offset)
        offset += appCodeBytes.length
      }
      break
    }

    case MESSAGE_TYPE.Leave: {
      // Room ID
      const roomIdBytes = textEncoder.encode(msg.roomId)
      const roomIdLen = encodeULEB128(roomIdBytes.length)
      buffer.set(roomIdLen, offset)
      offset += roomIdLen.length
      buffer.set(roomIdBytes, offset)
      offset += roomIdBytes.length
      break
    }
  }

  return buffer
}