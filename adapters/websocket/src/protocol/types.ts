/**
 * Type definitions for the Loro Syncing Protocol.
 */

import {
  JOIN_ERROR_CODE,
  MESSAGE_TYPE,
  PERMISSION,
  UPDATE_ERROR_CODE,
} from "./constants.js"

/**
 * CRDT types supported by the protocol.
 */
export type CrdtType = "loro" | "ephemeral" | "ephemeral-persisted"

/**
 * Message type codes as a union type.
 */
export type MessageTypeCode = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE]

/**
 * Join error codes as a union type.
 */
export type JoinErrorCode =
  (typeof JOIN_ERROR_CODE)[keyof typeof JOIN_ERROR_CODE]

/**
 * Update error codes as a union type.
 */
export type UpdateErrorCode =
  (typeof UPDATE_ERROR_CODE)[keyof typeof UPDATE_ERROR_CODE]

/**
 * Permission levels as a union type.
 */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION]

/**
 * Permission as a string type for API convenience.
 */
export type PermissionString = "read" | "write"

/**
 * JoinRequest message.
 * Sent by a client to join a room and sync a document.
 */
export type JoinRequest = {
  type: typeof MESSAGE_TYPE.JoinRequest
  crdtType: CrdtType
  roomId: string
  authPayload: Uint8Array
  requesterVersion: Uint8Array
}

/**
 * JoinResponseOk message.
 * Sent by the server when a client successfully joins a room.
 */
export type JoinResponseOk = {
  type: typeof MESSAGE_TYPE.JoinResponseOk
  crdtType: CrdtType
  roomId: string
  permission: PermissionString
  receiverVersion: Uint8Array
  metadata: Uint8Array
}

/**
 * JoinError message.
 * Sent by the server when a client fails to join a room.
 */
export type JoinError = {
  type: typeof MESSAGE_TYPE.JoinError
  crdtType: CrdtType
  roomId: string
  code: JoinErrorCode
  message: string
  /** Only present for VersionUnknown errors */
  receiverVersion?: Uint8Array
  /** Application-specific error code (only for AppError) */
  appCode?: number
}

/**
 * DocUpdate message.
 * Sent to transmit document updates between peers.
 */
export type DocUpdate = {
  type: typeof MESSAGE_TYPE.DocUpdate
  crdtType: CrdtType
  roomId: string
  updates: Uint8Array[]
}

/**
 * UpdateError message.
 * Sent when an update fails to be applied.
 */
export type UpdateError = {
  type: typeof MESSAGE_TYPE.UpdateError
  crdtType: CrdtType
  roomId: string
  code: UpdateErrorCode
  message: string
  /** Application-specific error code (only for AppError) */
  appCode?: number
}

/**
 * Leave message.
 * Sent when a client leaves a room.
 */
export type Leave = {
  type: typeof MESSAGE_TYPE.Leave
  crdtType: CrdtType
  roomId: string
}

/**
 * Union of all protocol messages.
 */
export type ProtocolMessage =
  | JoinRequest
  | JoinResponseOk
  | JoinError
  | DocUpdate
  | UpdateError
  | Leave

/**
 * Type guard for JoinRequest.
 */
export function isJoinRequest(msg: ProtocolMessage): msg is JoinRequest {
  return msg.type === MESSAGE_TYPE.JoinRequest
}

/**
 * Type guard for JoinResponseOk.
 */
export function isJoinResponseOk(msg: ProtocolMessage): msg is JoinResponseOk {
  return msg.type === MESSAGE_TYPE.JoinResponseOk
}

/**
 * Type guard for JoinError.
 */
export function isJoinError(msg: ProtocolMessage): msg is JoinError {
  return msg.type === MESSAGE_TYPE.JoinError
}

/**
 * Type guard for DocUpdate.
 */
export function isDocUpdate(msg: ProtocolMessage): msg is DocUpdate {
  return msg.type === MESSAGE_TYPE.DocUpdate
}

/**
 * Type guard for UpdateError.
 */
export function isUpdateError(msg: ProtocolMessage): msg is UpdateError {
  return msg.type === MESSAGE_TYPE.UpdateError
}

/**
 * Type guard for Leave.
 */
export function isLeave(msg: ProtocolMessage): msg is Leave {
  return msg.type === MESSAGE_TYPE.Leave
}