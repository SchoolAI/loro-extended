---
"@loro-extended/adapter-websocket": minor
---

Add unified state machine for WebSocket client connection lifecycle

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
