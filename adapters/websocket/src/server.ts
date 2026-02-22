/**
 * Server-side exports for the native WebSocket adapter.
 *
 * @packageDocumentation
 */

// Wire format (for advanced use cases)
export {
  decodeFrame,
  encodeBatchFrame,
  encodeFrame,
  fromWireFormat,
  MessageType,
  toWireFormat,
  WIRE_VERSION,
  WireFlags,
} from "@loro-extended/wire-format"
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
// Server adapter
export { WsServerNetworkAdapter, wrapWsSocket } from "./server-adapter.js"
