/**
 * Native WebSocket adapter for loro-extended.
 *
 * This package provides WebSocket-based network adapters that directly
 * transmit ChannelMsg types without protocol translation.
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
// Client adapter
export {
  type ConnectionState,
  createServiceWsClient,
  createWsClient,
  DEFAULT_FRAGMENT_THRESHOLD,
  type DisconnectReason,
  type ServiceWsClientOptions,
  type WsClientLifecycleEvents,
  WsClientNetworkAdapter,
  type WsClientOptions,
  type WsClientState,
  type WsClientStateTransition,
} from "./client.js"
// State machine (for advanced use cases)
export { WsClientStateMachine } from "./client-state-machine.js"
// Connection
export { WsConnection, type WsConnectionConfig } from "./connection.js"
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
export {
  type WsServerAdapterOptions,
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "./server-adapter.js"
