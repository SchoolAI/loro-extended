# Ephemeral/Presence System Investigation

## Problem Statement

The presence system (via loro-crdt's EphemeralStore) in `./packages/repo` is unreliable in the chat example app. In a hub-and-spoke topology with 2 clients connected to a server:

- The count of users does not rise immediately when a new client connects
- It takes until the next heartbeat (10 seconds) to get updated presence information from another client

## Observed Facts

### From Real-World Logs (Chat App)

```
06:35:01.213 DBG ephemeral-local-change for chat-f18287d4-0d8f-4ade-afbc-54e45a7e4511 : broadcasting to 0 channels
06:35:01.216 DBG channelAdded: undefined
06:35:01.216 DBG channelEstablish: 1
06:35:01.235 DBG handleEphemeral: received for chat-f18287d4-0d8f-4ade-afbc-54e45a7e4511 from channel 1, hopsRemaining=0
```

Key observations:
1. At `01.213` - Client sets presence, broadcasts to **0 channels** (no connections yet)
2. At `01.216` - Channel is added and establishment begins
3. At `01.235` - Client receives ephemeral data from server with `hopsRemaining=0`

### From Test Investigation

1. **Test 2 always passes** ("should propagate presence from late joiner to existing clients")
   - This test waits for connection to establish before setting presence

2. **Tests 1 and 3 are flaky** ("should propagate presence set immediately after repo creation", "should handle presence set in same tick as repo creation")
   - These tests set presence immediately after repo creation, before channel establishment

3. The BridgeAdapter's `onStart()` is async but called with `void adapter._start()` in the Synchronizer constructor, meaning channel establishment happens asynchronously after the constructor returns.

## Hypotheses

### Hypothesis 1: Presence Set Before Channel Establishment (CONFIRMED)

**Problem**: When presence is set before the channel is established, the broadcast goes to 0 channels and the presence is never sent to the server.

**Evidence**: 
- Logs show "broadcasting to 0 channels" at the moment presence is set
- Channel establishment happens 3ms later

**Root Cause**: The React pattern of setting presence in `useEffect` happens synchronously after component mount, but channel establishment is asynchronous.

### Hypothesis 2: Missing Ephemeral Broadcast on Channel Establishment (PARTIALLY FIXED)

**Problem**: When a channel is established, there's no mechanism to broadcast ephemeral data that was set before the channel existed.

**Evidence**:
- No code path broadcasts ephemeral data when `establish-response` is received
- The `handle-sync-request.ts` sends ephemeral data to the requesting client, but doesn't relay the client's presence to other clients

### Hypothesis 3: Race Condition in Message Ordering (SUSPECTED)

**Problem**: Even with fixes, tests are flaky, suggesting a race condition in message ordering.

**Evidence**:
- Tests pass sometimes and fail sometimes with the same code
- The BridgeAdapter processes messages synchronously, but the order of async operations (adapter start, channel establishment, sync handshake) can vary

**Suspected Cause**: The ephemeral broadcast in `handle-sync-response` happens, but by the time it reaches the server, the server may not have set up subscriptions for other clients yet.

## Code Locations

### Key Files

1. **[`handle-ephemeral.ts`](../packages/repo/src/synchronizer/ephemeral/handle-ephemeral.ts)** - Handles incoming ephemeral messages and relays them
2. **[`handle-establish-response.ts`](../packages/repo/src/synchronizer/connection/handle-establish-response.ts)** - Client-side channel establishment
3. **[`handle-sync-request.ts`](../packages/repo/src/synchronizer/sync/handle-sync-request.ts)** - Server-side sync handling, sends ephemeral to requesting client
4. **[`handle-sync-response.ts`](../packages/repo/src/synchronizer/sync/handle-sync-response.ts)** - Client-side sync response handling
5. **[`synchronizer-dispatcher.ts`](../packages/repo/src/synchronizer/synchronizer-dispatcher.ts)** - Handles `ephemeral-local-change` events

### Message Flow (Hub-and-Spoke)

```
ClientB                    Server                     ClientA
   |                         |                          |
   |-- establish-request --->|                          |
   |<-- establish-response --|                          |
   |-- sync-request -------->|                          |
   |                         |-- (relay ephemeral?) --->|
   |<-- sync-response -------|                          |
   |-- ephemeral broadcast ->|                          |
   |                         |-- (relay to ClientA) --->|
```

---

## Addendum: Fixes Attempted During This Session

### Fix 1: `handle-ephemeral.ts` - Relay Original Data (APPLIED)

**Problem Found**: The `handleEphemeral` function was building a `commands` array but only returning the `apply` command, ignoring the `broadcast` command.

**Fix**: Changed to use `cmd/send-message` to relay the original ephemeral data (not re-encode it) to other peers, filtering out the sender channel.

**Status**: Applied and tests pass for this specific fix.

### Fix 2: `handle-establish-response.ts` - Broadcast Ephemeral on Establishment (PARTIALLY APPLIED)

**Problem Found**: When a client receives `establish-response`, it doesn't broadcast its ephemeral data to the newly established channel.

**Fix Attempted**: Added ephemeral broadcast commands for all documents when `establish-response` is received.

**Status**: Partially applied. The fix was reverted for the "new peer" path because it caused issues with message ordering (ephemeral broadcast happens before server has subscriptions).

### Fix 3: `handle-sync-response.ts` - Broadcast Ephemeral After Sync (APPLIED)

**Problem Found**: After receiving `sync-response`, the client should broadcast its ephemeral data to ensure presence set before channel establishment is propagated.

**Fix**: Added `cmd/broadcast-ephemeral` command after `cmd/import-doc-data` in both `snapshot`/`update` and `up-to-date` cases.

**Status**: Applied but tests are now failing because existing tests expect specific command types.

### Tests Created

1. **[`ephemeral-presence-before-connect.test.ts`](../packages/repo/src/tests/ephemeral-presence-before-connect.test.ts)** - Tests for the specific bug scenario:
   - "should propagate presence set immediately after repo creation" (FLAKY)
   - "should propagate presence from late joiner to existing clients" (PASSES)
   - "should handle presence set in same tick as repo creation" (FLAKY)

### Current State

- The core fix (broadcasting ephemeral on sync-response) is in place
- Several existing tests need to be updated to account for the new ephemeral broadcast commands
- The new tests are flaky, indicating there's still a race condition that needs investigation
- The flakiness may be due to the async nature of adapter startup and the order of message processing

### Next Steps

1. Update `handle-sync-response.test.ts` to expect batched commands including ephemeral broadcasts
2. Update `handle-establish-response.test.ts` to account for ephemeral broadcasts in reconnection path
3. Investigate the race condition causing test flakiness - may need to ensure ephemeral broadcasts happen after all sync handshakes are complete
4. Consider adding a mechanism to queue ephemeral broadcasts until channels are fully established