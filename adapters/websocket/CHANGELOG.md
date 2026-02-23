# @loro-extended/adapter-websocket

## 6.0.0-beta.0

### Minor Changes

- 7f11f55: Add unified state machine for WebSocket client connection lifecycle

  This release introduces a new state machine architecture for the WebSocket client adapter that provides:

  **New Features:**

  - **Unified state machine** (`WsClientStateMachine`) that replaces the previous inconsistent state properties
  - **Observable state transitions** delivered asynchronously via microtask queue, ensuring all states can be observed
  - **New `ready` state** that distinguishes between "socket open" and "server ready signal received"
  - **Lifecycle events** via `WsClientLifecycleEvents` options:
    - `onStateChange` - Called on every state transition
    - `onDisconnect` - Called when connection is lost with disconnect reason
    - `onReconnecting` - Called when reconnection is scheduled
    - `onReconnected` - Called when reconnection succeeds
    - `onReady` - Called when server sends ready signal
  - **New public APIs**:
    - `getState()` - Get current state with full details
    - `subscribeToTransitions()` - Subscribe to state transitions
    - `waitForState()` / `waitForStatus()` - Async helpers for waiting for specific states
    - `isReady` - Check if connection is fully established

  **Bug Fixes:**

  - Fixed race condition where the "disconnected" state was unobservable because reconnection was scheduled synchronously
  - Fixed issue where channel `stop()` callback would transition to disconnected before reconnection could be scheduled

  **Backward Compatibility:**

  - `connectionState` getter still works (maps `ready` to `connected`)
  - `subscribe()` method still works (deprecated in favor of `subscribeToTransitions()`)
  - `isConnected` getter still works (checks socket state)
  - `serverReady` getter still works (deprecated in favor of `isReady`)

### Patch Changes

- Updated dependencies [f90c7f7]
- Updated dependencies [a3f151f]
- Updated dependencies [29853c3]
  - @loro-extended/repo@6.0.0-beta.0
  - @loro-extended/wire-format@0.1.1-beta.0

## 5.4.2

### Patch Changes

- @loro-extended/repo@5.4.2

## 5.4.1

### Patch Changes

- @loro-extended/repo@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [b2614e6]
- Updated dependencies [cab74a3]
  - @loro-extended/repo@5.4.0

## 5.3.0

### Patch Changes

- Updated dependencies [c97a468]
  - @loro-extended/repo@5.3.0

## 5.2.0

### Patch Changes

- Updated dependencies [6048f48]
  - @loro-extended/repo@5.2.0

## 5.1.0

### Minor Changes

- bb304ea: Add factory functions for WebSocket client creation with clear API separation:

  - `createWsClient()` - For browser-to-server connections (no headers option)
  - `createServiceWsClient()` - For service-to-service connections (supports headers for auth)

  This provides a clearer API that guides developers to the correct usage pattern based on their environment. The `WsClientNetworkAdapter` class constructor is now deprecated in favor of these factory functions.

  New exports: `createWsClient`, `createServiceWsClient`, `ServiceWsClientOptions`

### Patch Changes

- @loro-extended/repo@5.1.0

## 5.0.0

### Patch Changes

- f941a95: Fix intermittent WebSocket connection establishment race condition

  The WebSocket server adapter was calling `establishChannel()` immediately after sending the "ready" signal, which could cause a race condition where binary messages arrived before the client had processed "ready" and created its channel.

  **Changes:**

  - Remove `establishChannel()` call from server adapters (websocket and websocket-compat)
  - The server's channel now gets established when it receives the client's `establish-request`
  - Add test verifying server does not send binary before client sends establish-request
  - Update documentation in `docs/messages.md` to clarify the establishment protocol

  This aligns the WebSocket adapters with the SSE adapter pattern, where only the client initiates the establishment handshake.

- Updated dependencies [f254aa2]
  - @loro-extended/repo@5.0.0

## 4.0.0

### Minor Changes

- 92112e1: Add ready signal and use real establish protocol

  **Ready Signal**

  - Server sends "ready" text frame after WebSocket setup completes
  - Client waits for "ready" before creating channel and sending messages
  - Fixes intermittent connection failures on page refresh caused by race condition

  **Real Establish Protocol**

  - Remove `simulateHandshake()` which injected fake protocol messages
  - Server and client now exchange real `establish-request`/`establish-response` messages
  - Peer identities are properly exchanged over the wire (no more hardcoded "server" peerId)
  - The Synchronizer's existing handlers process real protocol messages

### Patch Changes

- Updated dependencies [14b9193]
- Updated dependencies [37cdd5e]
- Updated dependencies [c3e5d1f]
  - @loro-extended/repo@4.0.0

## 3.0.0

### Major Changes

- a5df157: Replaced the Loro Protocol-based WebSocket adapter with a native loro-extended protocol adapter.

  **Breaking Changes:**

  - `@loro-extended/adapter-websocket` now uses a native wire format (MessagePack) instead of the Loro Syncing Protocol
  - The old Loro Protocol adapter is now available as `@loro-extended/adapter-websocket-compat`

  **New Native Adapter (`@loro-extended/adapter-websocket`):**

  - Directly transmits `ChannelMsg` types without protocol translation
  - Full support for all loro-extended message types (batch, directory, delete, new-doc)
  - Fixes hub-spoke synchronization issues caused by dropped `channel/batch` messages
  - Simpler implementation with better debugging

  **Compat Adapter (`@loro-extended/adapter-websocket-compat`):**

  - Moved from `@loro-extended/adapter-websocket`
  - Use this for interoperability with Loro Protocol servers

  **Migration:**

  - If you need Loro Protocol compatibility, change imports from `@loro-extended/adapter-websocket` to `@loro-extended/adapter-websocket-compat`
  - Otherwise, no changes needed - the API is compatible

### Minor Changes

- 7d6aab4: Add `wrapBunWebSocket` helper function for Bun runtime support. This provides a new `/bun` export that wraps Bun's `ServerWebSocket` to match the `WsSocket` interface expected by `WsServerNetworkAdapter`.
- 57ebdfb: Replace MessagePack with tiny-cbor for wire format encoding. Uses CBOR (RFC 8949) which provides a smaller library footprint (~1KB gzipped) while maintaining compact binary encoding. Also allows bun to package without .cjs complication.

### Patch Changes

- d893fe9: Add synchronous receive queue to Synchronizer for recursion prevention

  The Synchronizer now uses a receive queue to handle incoming messages iteratively,
  preventing infinite recursion when adapters deliver messages synchronously.

  **Key changes:**

  - Synchronizer.channelReceive() now queues messages and processes them iteratively
  - Removed queueMicrotask() from BridgeAdapter.deliverMessage() - now synchronous
  - Removed queueMicrotask() from StorageAdapter.reply() - now synchronous
  - Removed queueMicrotask() from WsConnection.handleProtocolMessage() and simulateHandshake()
  - Removed queueMicrotask() from WsClientNetworkAdapter.handleProtocolMessage()
  - Updated test-utils.ts documentation to explain flushMicrotasks() is rarely needed

  **Benefits:**

  - Single location for recursion prevention (Synchronizer, not scattered across adapters)
  - Works for all adapters automatically (BridgeAdapter, StorageAdapter, WebSocket, future adapters)
  - Simpler tests - no async utilities needed for basic message handling
  - Completely synchronous message processing within a single dispatch cycle

- 3f6caf5: Fix "Unsupported data type" error when decoding WebSocket messages in Bun

  The `decodeFrame` function now normalizes `Buffer` subclasses to plain `Uint8Array` before passing to the CBOR decoder. This fixes compatibility with Bun's WebSocket implementation which may return `Buffer` instances instead of plain `Uint8Array`.

- Updated dependencies [d893fe9]
- Updated dependencies [786b8b1]
- Updated dependencies [8061a20]
- Updated dependencies [cf064fa]
- Updated dependencies [1b2a3a4]
- Updated dependencies [702871b]
- Updated dependencies [27cdfb7]
  - @loro-extended/repo@3.0.0
