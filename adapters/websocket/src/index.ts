/**
 * WebSocket adapter for loro-extended.
 *
 * This package provides WebSocket-based network adapters that implement
 * the Loro Syncing Protocol for real-time document synchronization.
 *
 * @packageDocumentation
 */

// Client adapter
export { WsClientNetworkAdapter, type WsClientOptions } from "./client.js"
// Connection
export { WsConnection } from "./connection.js"
// Handler types
export type {
  WsConnectionHandle,
  WsConnectionOptions,
  WsConnectionResult,
  WsReadyState,
  WsSocket,
  WsSocketWrapper,
} from "./handler/types.js"
export { wrapStandardWebSocket } from "./handler/types.js"
// Protocol (re-export commonly used items)
export {
  type CrdtType,
  type DocUpdate,
  decodeMessage,
  encodeMessage,
  type JoinError,
  type JoinRequest,
  type JoinResponseOk,
  type Leave,
  MESSAGE_TYPE,
  type ProtocolMessage,
  type UpdateError,
} from "./protocol/index.js"
// Server adapter
export { WsServerNetworkAdapter, wrapWsSocket } from "./server-adapter.js"
