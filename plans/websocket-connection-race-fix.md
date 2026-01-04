# WebSocket Connection Establishment Race Condition Fix

## Problem Statement

The WebSocket adapter has an intermittent issue where connections do not establish immediately. This manifests as a race condition that occurs rarely but causes connection failures.

## Background

### Channel Establishment Protocol

A channel transitions from `connected` to `established` state when it receives either:

1. `establish-request` → handled by [`handle-establish-request.ts:52-57`](../packages/repo/src/synchronizer/connection/handle-establish-request.ts:52)
2. `establish-response` → handled by [`handle-establish-response.ts:78-84`](../packages/repo/src/synchronizer/connection/handle-establish-response.ts:78)

The `establishChannel()` method **always sends `establish-request`** ([`handle-establish-channel.ts:75-84`](../packages/repo/src/synchronizer/connection/handle-establish-channel.ts:75)).

### Correct Pattern (SSE Adapter)

The SSE adapter implements the correct client/server pattern:

- **Server** ([`sse/server-adapter.ts`](../adapters/sse/src/server-adapter.ts)): Only calls `addChannel()`, never `establishChannel()`
- **Client** ([`sse/client.ts:181`](../adapters/sse/src/client.ts:181)): Calls `establishChannel()` on connection open

Flow:

```
Client                          Server
  |                               |
  |-- establish-request --------->|  (client calls establishChannel)
  |                               |  Server channel → established
  |<-- establish-response --------|  (handle-establish-request sends)
  |  Client channel → established |
```

### Current WebSocket Problem

Both client AND server call `establishChannel()`:

- **Server** ([`websocket/server-adapter.ts:153`](../adapters/websocket/src/server-adapter.ts:153))
- **Client** ([`websocket/client.ts:338`](../adapters/websocket/src/client.ts:338))

This creates a race condition:

```
Client                          Server
  |                               |
  |<-------- WebSocket Open ----->|
  |                               |
  |<-- "ready" (text) ------------|
  |<-- establish-request (binary)-|  ← Server sends immediately
  |                               |     (RACE: may arrive before
  |                               |      client processes "ready")
  |-- establish-request --------->|  ← Client sends after "ready"
```

If the binary `establish-request` arrives before the client processes the `"ready"` text message, the client's channel doesn't exist yet and the message is dropped.

## Gap Analysis

### Affected Adapters

| Adapter              | Server calls `establishChannel()`? | Client calls `establishChannel()`? | Issue              |
| -------------------- | ---------------------------------- | ---------------------------------- | ------------------ |
| **SSE**              | ❌ No                              | ✅ Yes                             | ✅ Correct         |
| **HTTP Polling**     | N/A (no server adapter)            | ✅ Yes                             | ✅ Correct         |
| **WebSocket**        | ✅ Yes                             | ✅ Yes                             | ❌ Race condition  |
| **WebSocket-compat** | ✅ Yes + simulates handshake       | ✅ Yes + simulates handshake       | ❌ Different issue |
| **WebRTC**           | N/A (peer-to-peer)                 | ✅ Yes (both peers)                | ✅ Correct for P2P |

### websocket-compat Special Case

The `websocket-compat` adapter translates between the Loro Syncing Protocol and loro-extended messages. It has a different problem:

- Both sides call `establishChannel()` AND inject fake `establish-response` messages
- This is a workaround because the Loro Protocol doesn't have peer-level handshake
- The fix approach is different: remove redundant `establishChannel()` from server, keep the simulated handshake

## Success Criteria

1. **WebSocket adapter**: Server does NOT call `establishChannel()` - only client initiates
2. **WebSocket-compat adapter**: Server does NOT call `establishChannel()` - only client initiates
3. **Tests**: Cover the scenario where server sends binary before client is ready
4. **Documentation**: [`docs/messages.md`](../docs/messages.md) clearly explains that only ONE side should call `establishChannel()`
5. **No regressions**: All existing tests pass

## Dependency Analysis

### Direct Dependencies

- `adapters/websocket/src/server-adapter.ts` → Change: Remove `establishChannel()` call
- `adapters/websocket/src/client.ts` → No change needed (already correct after "ready")
- `adapters/websocket-compat/src/server-adapter.ts` → Change: Remove `establishChannel()` call
- `adapters/websocket-compat/src/client.ts` → No change needed

### Transitive Dependencies

- `packages/repo/src/synchronizer/connection/handle-establish-request.ts` → No change (already handles incoming requests correctly)
- `packages/repo/src/synchronizer/connection/handle-establish-response.ts` → No change
- `packages/repo/src/adapter/adapter.ts` → No change (establishChannel method unchanged)

### Test Dependencies

- `adapters/websocket/src/__tests__/ready-signal.test.ts` → May need updates
- `adapters/websocket/src/__tests__/e2e.test.ts` → Should continue to pass
- `adapters/websocket-compat/src/__tests__/*.test.ts` → May need updates

## Implementation Plan

### Phase 1: Fix WebSocket Adapter

- [ ] **1.1** Remove `establishChannel()` call from [`websocket/server-adapter.ts:153`](../adapters/websocket/src/server-adapter.ts:153)
- [ ] **1.2** Update comments to explain the client-first pattern
- [ ] **1.3** Run existing tests to verify no regressions

### Phase 2: Fix WebSocket-compat Adapter

- [ ] **2.1** Remove `establishChannel()` call from [`websocket-compat/server-adapter.ts:163`](../adapters/websocket-compat/src/server-adapter.ts:163)
- [ ] **2.2** Keep `simulateHandshake()` call (still needed for Loro Protocol translation)
- [ ] **2.3** Update comments to explain the pattern
- [ ] **2.4** Run existing tests to verify no regressions

### Phase 3: Add/Update Tests

- [ ] **3.1** Add test verifying server does NOT send binary before client sends establish-request
- [ ] **3.2** Add stress test for rapid connect/disconnect cycles
- [ ] **3.3** Add test verifying connection works when "ready" is delayed

### Phase 4: Update Documentation

- [ ] **4.1** Update [`docs/messages.md`](../docs/messages.md) Phase 2 section to clarify:
  - Only the initiating side (client) should call `establishChannel()`
  - The responding side's channel is established by receiving `establish-request`
  - For P2P adapters (WebRTC), either side can initiate

### Phase 5: Verification

- [ ] **5.1** Run full test suite: `pnpm test`
- [ ] **5.2** Run WebSocket-specific tests: `pnpm --filter @loro-extended/adapter-websocket test`
- [ ] **5.3** Run WebSocket-compat tests: `pnpm --filter @loro-extended/adapter-websocket-compat test`
