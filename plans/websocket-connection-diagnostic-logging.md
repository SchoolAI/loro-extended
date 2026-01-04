# WebSocket Connection Diagnostic Logging Plan

## Problem Statement

The WebSocket adapter has an intermittent issue where connections do not establish immediately. This occurs rarely and has been difficult to reproduce in tests. Despite previous fixes (removing server-side `establishChannel()` call), the issue persists in production apps using loro-extended/websocket.

## Background

### Connection Establishment Flow

The WebSocket connection establishment involves multiple components across two packages:

**Client Side (`adapters/websocket/src/client.ts`):**
1. WebSocket `open` event fires
2. Client waits for "ready" text message from server
3. On "ready" → creates channel via `addChannel()`, then calls `establishChannel()`
4. Sends `establish-request` to server
5. Receives `establish-response`, marks channel as `established`

**Server Side (`adapters/websocket/src/server-adapter.ts` + `connection.ts`):**
1. `handleConnection()` creates channel via `addChannel()`
2. `start()` calls `connection.sendReady()` (sends "ready" text message)
3. Server waits for client's `establish-request`
4. Receives `establish-request`, marks channel as `established`, sends `establish-response`

**Synchronizer (`packages/repo/src/synchronizer.ts`):**
- `channelAdded()` → dispatches `synchronizer/channel-added` → registers channel (state: `connected`)
- `channelEstablish()` → dispatches `synchronizer/establish-channel` → sends `establish-request`
- `channelReceive()` → queues message via work queue → processes message

### Previous Fix Applied

We removed the server-side `establishChannel()` call to prevent a race condition where the server's binary `establish-request` could arrive before the client processed "ready" and created its channel.

## Gap Analysis

### Remaining Potential Race Conditions

1. **"ready" message delivery timing**: The "ready" text message is sent immediately after `connection.start()`. If there's any delay in the client processing this message, subsequent binary messages could arrive before the client has created its channel.

2. **Channel lookup timing**: In [`handleChannelMessage()`](../adapters/websocket/src/connection.ts:92), if `this.channel` is null, the message is dropped with `console.error`. This could happen if:
   - The channel was removed between message receipt and processing
   - The channel was never set (race in initialization)

3. **Synchronizer work queue timing**: Messages are queued via `channelReceive()` → `#workQueue.enqueue()`. If the channel state changes during processing, messages could be processed against stale state.

4. **Channel state transitions**: The channel transitions from `connected` → `established` when receiving `establish-request` or `establish-response`. If messages arrive during this transition, they might be rejected.

### What We Don't Know

- **Exact timing** of events when the failure occurs
- **Which side** (client or server) is failing
- **What message type** is being dropped or delayed
- **Whether the channel exists** when messages arrive

## Success Criteria

1. **Diagnostic logs** are added to all critical points in the connection flow
2. **Timestamps** are included to identify timing issues
3. **Channel state** is logged at each point to identify state mismatches
4. **Message types** are logged to identify which messages are affected
5. **Logs are parseable** - consistent format with prefixes for easy grep/filtering
6. **Minimal performance impact** - logs only at critical points, not every message

## Dependency Analysis

### Direct Dependencies

| File | Changes | Purpose |
|------|---------|---------|
| `adapters/websocket/src/client.ts` | Add 5 console.log statements | Track client-side connection flow |
| `adapters/websocket/src/connection.ts` | Add 2 console.log statements | Track server-side message handling |
| `adapters/websocket/src/server-adapter.ts` | Add 2 console.log statements | Track server-side connection setup |
| `packages/repo/src/synchronizer.ts` | Add 3 console.log statements | Track synchronizer channel lifecycle |

### Transitive Dependencies

```
adapters/websocket/src/client.ts
  └── @loro-extended/repo (Adapter base class, Channel types)
       └── packages/repo/src/synchronizer.ts (receives channelAdded, channelEstablish, channelReceive)
            └── packages/repo/src/synchronizer-program.ts (processes messages)
                 └── packages/repo/src/synchronizer/connection/*.ts (handles establish-request/response)

adapters/websocket/src/server-adapter.ts
  └── adapters/websocket/src/connection.ts (WsConnection class)
       └── adapters/websocket/src/wire-format.ts (encodeFrame, decodeFrame)
  └── @loro-extended/repo (Adapter base class)
       └── packages/repo/src/synchronizer.ts (same as above)
```

### Risk Assessment

- **Low risk**: Adding console.log statements does not change behavior
- **No breaking changes**: Existing tests should continue to pass
- **Reversible**: Logs can be removed or converted to proper logging after diagnosis

## Implementation Plan

### Phase 1: Add Client-Side Diagnostic Logs

- [x] **1.1** Add log after WebSocket opens (before waiting for "ready")
- [x] **1.2** Add log when "ready" text message is received
- [x] **1.3** Add log in `handleServerReady()` when creating channel
- [x] **1.4** Add log after `establishChannel()` is called
- [x] **1.5** Add log in `handleChannelMessage()` with channel state

### Phase 2: Add Server-Side Diagnostic Logs

- [x] **2.1** Add log in `handleConnection()` when channel is created
- [x] **2.2** Add log in `start()` before sending "ready"
- [x] **2.3** Add log in `sendReady()` when "ready" is sent
- [x] **2.4** Add log in `handleChannelMessage()` with channel state

### Phase 3: Add Synchronizer Diagnostic Logs

- [x] **3.1** Add log in `channelAdded()` with channel details
- [x] **3.2** Add log in `channelEstablish()` with channel details
- [x] **3.3** Add log in `channelReceive()` with channel existence check

### Phase 4: Test and Verify

- [x] **4.1** Run existing WebSocket adapter tests to ensure no regressions
- [ ] **4.2** Deploy to external app for real-world testing
- [ ] **4.3** Collect logs when issue occurs
- [ ] **4.4** Analyze logs to identify root cause

## Log Format Specification

All logs will follow this format for easy parsing:

```
[PREFIX] description at TIMESTAMP, key1=value1, key2=value2
```

Prefixes:
- `[WS-CLIENT]` - Client-side WebSocket adapter
- `[WS-SERVER]` - Server-side WebSocket adapter/connection
- `[SYNC]` - Synchronizer

Example:
```
[WS-CLIENT] WebSocket OPEN at 1704312000000, waiting for "ready"
[WS-SERVER] sendReady at 1704312000001, peerId=ws-abc123
[WS-CLIENT] "ready" received at 1704312000002, serverReady=false
[WS-CLIENT] handleServerReady at 1704312000003, creating channel
[SYNC] channelAdded at 1704312000004, channelId=1
[WS-CLIENT] establishChannel called at 1704312000005, channelId=1
[SYNC] channelEstablish at 1704312000006, channelId=1
```
