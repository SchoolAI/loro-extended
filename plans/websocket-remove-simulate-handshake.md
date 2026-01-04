# Plan: Remove simulateHandshake from Native WebSocket Adapter

## Problem Statement

The native WebSocket adapter (`adapters/websocket`) uses `simulateHandshake()` to bypass the real loro-extended establish protocol. This method locally injects fake `establish-request` and `establish-response` messages that never crossed the wire, causing:

1. **Corrupted peer state** - The Synchronizer believes it received identity information from the remote peer, but it has placeholder data (e.g., hardcoded `"server"` peerId)
2. **Protocol fraud** - The channel is marked "established" based on fabricated messages
3. **Unnecessary complexity** - We added a "ready" signal to fix race conditions that exist only because we're not using the real protocol

## Background

### Current Flow (Broken)

**Server side** (`server-adapter.ts:142-152`):
```typescript
start: () => {
  connection.start()
  this.establishChannel(channel.channelId)  // Sends real establish-request
  connection.simulateHandshake(peerId)       // FAKE: Injects fake messages locally
  connection.sendReady()
}
```

**Client side** (`client.ts:328-341`):
```typescript
this.serverChannel = this.addChannel()
this.establishChannel(this.serverChannel.channelId)  // Sends real establish-request

// FAKE: Inject fake establish-response locally
this.serverChannel.onReceive({
  type: "channel/establish-response",
  identity: { peerId: "server" as PeerID, ... },  // Hardcoded!
})
```

### Why This Exists

The `simulateHandshake` pattern was copied from `websocket-compat`, where it's necessary because the Loro Syncing Protocol has no peer-level handshake. For the native adapter, we control both ends and should use the real protocol.

### The Real Protocol

The Synchronizer already has handlers for the establish protocol:
- `handle-establish-request.ts` - Receives request, sends response, initiates sync
- `handle-establish-response.ts` - Receives response, initiates sync

## The Gap

The native WebSocket adapter bypasses these handlers by injecting fake messages. We need to:
1. Remove the fake message injection
2. Let real protocol messages flow through the wire
3. Process them through the existing Synchronizer handlers

## Dependency Analysis

### Direct Dependencies

| Component | Impact |
|-----------|--------|
| `WsConnection.simulateHandshake()` | Remove method |
| `WsServerNetworkAdapter.handleConnection()` | Remove `simulateHandshake()` call |
| `WsClientNetworkAdapter.handleServerReady()` | Remove fake `establish-response` injection |

### Transitive Dependencies

| Chain | Impact |
|-------|--------|
| Client → `handleServerReady()` → `establishChannel()` → Synchronizer | Client will send real `establish-request` |
| Server → `handleConnection()` → `establishChannel()` → Synchronizer | Server will send real `establish-request` |
| Wire → `handleChannelMessage()` → `channel.onReceive()` → Synchronizer handlers | Real messages will be processed |

### Synchronizer Handlers (No Changes Needed)

These handlers already exist and work correctly:
- `handle-establish-request.ts` - Will process incoming requests
- `handle-establish-response.ts` - Will process incoming responses
- `handle-establish-channel.ts` - Already called by `establishChannel()`

## Success Criteria

1. **Real identity exchange** - Server and client exchange actual peer identities over the wire
2. **No fake messages** - `simulateHandshake()` removed from native adapter
3. **Correct peer state** - Synchronizer has accurate peer information
4. **All tests pass** - Existing e2e and ready-signal tests continue to work
5. **"Ready" signal preserved** - Transport-level readiness indicator remains

## Implementation Plan

### Phase 1: Server Changes

1. **Remove `simulateHandshake()` call** from `server-adapter.ts`
2. **Keep `establishChannel()` call** - This sends the real `establish-request`
3. **Keep `sendReady()` call** - Transport-level readiness

After change:
```typescript
start: () => {
  connection.start()
  this.establishChannel(channel.channelId)  // Sends real establish-request
  connection.sendReady()                     // Transport ready signal
}
```

### Phase 2: Client Changes

1. **Remove fake `establish-response` injection** from `handleServerReady()`
2. **Keep channel creation and `establishChannel()` call**
3. **Let real `establish-response` come from server**

After change:
```typescript
private handleServerReady(): void {
  this.serverReady = true
  this.serverChannel = this.addChannel()
  this.establishChannel(this.serverChannel.channelId)  // Sends real establish-request
  // Real establish-response will arrive from server via handleChannelMessage()
}
```

### Phase 3: Remove Dead Code

1. **Remove `simulateHandshake()` method** from `connection.ts`
2. **Update tests** if any directly test `simulateHandshake()`

### Phase 4: Verify Protocol Flow

Expected message flow after changes:

```
Client                              Server
  |                                    |
  |<---------- "ready" (text) ---------|  (transport ready)
  |                                    |
  |-- establish-request (binary) ----->|  (client initiates)
  |                                    |  (server processes via handle-establish-request)
  |<----- establish-response (binary) -|  (server responds)
  |                                    |  (client processes via handle-establish-response)
  |                                    |
  |<----- establish-request (binary) --|  (server also initiates - bidirectional)
  |                                    |  (client processes via handle-establish-request)
  |-- establish-response (binary) ---->|  (client responds)
  |                                    |  (server processes via handle-establish-response)
  |                                    |
  |<========= sync begins ============>|
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Timing issues with bidirectional establish | The Synchronizer handlers are designed for this; they handle both directions |
| Tests rely on immediate establishment | Update tests to wait for real protocol completion |
| Performance regression from round-trip | Negligible; establish happens once per connection |

## Out of Scope

- Changes to `websocket-compat` adapter (it legitimately needs `simulateHandshake`)
- Protocol simplification (making establish unidirectional)
- Changes to Synchronizer handlers
