/**
 * Server-side exports for the WebSocket adapter.
 *
 * @packageDocumentation
 */

// Server adapter
export { WsServerNetworkAdapter, wrapWsSocket } from "./server-adapter.js"

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
  decodeMessage,
  encodeMessage,
  MESSAGE_TYPE,
  type CrdtType,
  type DocUpdate,
  type JoinError,
  type JoinRequest,
  type JoinResponseOk,
  type Leave,
  type ProtocolMessage,
  type UpdateError,
} from "./protocol/index.js"