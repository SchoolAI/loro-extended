# Plan: Storage-First Sync Coordination

**Status: IMPLEMENTED** ✅ (v3 - includes lazy loading)

## Problem Statement

When a server has both network (WebSocket) and storage (LevelDB) adapters, network sync-requests are answered BEFORE storage has loaded the document data. This causes clients to incorrectly believe the document is empty, leading to duplicate initialization (e.g., two root nodes in a tree).

### Solution: Storage-First Sync + Lazy Loading

We implemented two complementary changes:

1. **Storage-First Sync**: Network sync-requests for unknown documents now wait for all storage adapters to be consulted before responding.

2. **Lazy Loading**: Removed eager loading from `StorageAdapter`. Documents are now loaded on-demand when network clients request them, rather than all at once on startup.

### Benefits of Lazy Loading

- **Scales to millions of documents** - No startup memory spike
- **Reduces startup time** - Server is ready immediately
- **Avoids race conditions** - No eager loading race to worry about
- **Memory efficient** - Only loads requested documents

## Background

### Current Behavior

```
Timeline (Server with WebSocket + LevelDB):

T0: Server starts, both adapters initialize
T1: Storage channel establishes, sends establish-response
T2: Storage calls requestStoredDocuments() (async)
T3: Client connects via WebSocket
T4: Client sends sync-request for "doc-123"
T5: Server handleSyncRequest() - model.documents.get("doc-123") = undefined
T6: Server creates empty doc, responds with "unavailable"
T7: Client creates root (because server said empty)
T8: Storage loadRange() completes, sends sync-request for "doc-123"
T9: Server imports storage data into "doc-123"
T10: Server sends sync-response with data to client
T11: Client now has 2 roots! 💥
```

### Why This Happens

The `StorageAdapter` loads documents asynchronously AFTER channel establishment:

```typescript
// StorageAdapter.handleEstablishRequest()
async handleEstablishRequest(): Promise<void> {
  // Respond immediately
  this.reply({ type: "channel/establish-response", ... })

  // THEN load stored documents (async!)
  await this.requestStoredDocuments()
}
```

### Key Architectural Constraint

The Synchronizer uses the TEA (The Elm Architecture) pattern with **synchronous updates**. The `channelDispatcher` and `handleSyncRequest` return `Command | undefined`, not `Promise`. This means we cannot simply `await` storage - we need a different approach.

## The Gap

The Synchronizer has no coordination between adapters. When a network sync-request arrives:

1. It immediately responds based on current LoroDoc state
2. It doesn't know that storage might have data for this document
3. It doesn't wait for storage to load before responding

## Success Criteria

1. ✅ Network sync-requests wait for ALL storage adapters before responding
2. ✅ Default behavior is "wait for storage" (opt-out available)
3. ✅ Configurable timeout (default 10s) for storage loading
4. ✅ Storage errors treated same as timeout (respond with current state)
5. ✅ Explicit state tracking in DocState (no hidden semantics)
6. ✅ No new protocol transmission types (simpler design)
7. ✅ All existing tests pass
8. ✅ New tests cover storage-first sync scenarios

## Proposed Solution: Queue-Based Deferred Response

### Core Insight

Instead of sending a "pending" response and then a follow-up, we simply **don't respond until storage has been consulted**. Network requests are queued in DocState and processed when all storage adapters have responded.

### Key Design Principles

1. **No new transmission types** - Single sync-response to network peer
2. **Wait for ALL storage adapters** - Any storage might have the document
3. **Explicit state tracking** - `pendingStorageChannels` and `pendingNetworkRequests` in DocState
4. **Fully synchronous** - Each step is a synchronous message handler

### DocState Changes

```typescript
type DocState = {
  docId: DocId
  doc: LoroDoc
  ephemeralStores: Map<string, TimerlessEphemeralStore>
  
  /**
   * Storage channels we're waiting to hear from.
   * When this becomes empty, we process pendingNetworkRequests.
   */
  pendingStorageChannels: Set<ChannelId>
  
  /**
   * Network sync-requests waiting for storage to be consulted.
   * When all storage responds, we send sync-responses to these.
   */
  pendingNetworkRequests: Array<{
    channelId: ChannelId
    requesterDocVersion: VersionVector
  }>
}
```

### Protocol Flow

**Case 1: Storage has the document**
```
Client                          Server                         Storage
  |                               |                               |
  |-- sync-request "doc-123" --->|                               |
  |                               | (doc not in model)           |
  |                               | (has storage adapters)       |
  |                               | Create doc                   |
  |                               | Queue network request        |
  |                               | pendingStorageChannels={s1}  |
  |                               |                               |
  |                               |-- sync-request "doc-123" --->|
  |                               |                               |
  | (client waits for response)   |<-- sync-response with data --|
  |                               | Import data                  |
  |                               | pendingStorageChannels={}    |
  |                               | Process queued requests      |
  |                               |                               |
  |<-- sync-response with data --|                               |
  |                               |                               |
  | (waitForSync resolves!)       |                               |
```

**Case 2: Storage doesn't have the document**
```
Client                          Server                         Storage
  |                               |                               |
  |-- sync-request "doc-123" --->|                               |
  |                               | Create doc                   |
  |                               | Queue network request        |
  |                               |-- sync-request "doc-123" --->|
  |                               |                               |
  | (client waits for response)   |<-- sync-response "unavail" --|
  |                               | pendingStorageChannels={}    |
  |                               | Process queued requests      |
  |                               |                               |
  |<-- sync-response "unavail" --|                               |
  |                               |                               |
  | (waitForSync resolves!)       |                               |
```

**Case 3: Multiple storage adapters**
```
Client                          Server                    Storage1    Storage2
  |                               |                           |           |
  |-- sync-request "doc-123" --->|                           |           |
  |                               | pendingStorageChannels=  |           |
  |                               |   {s1, s2}               |           |
  |                               |-- sync-request --------->|           |
  |                               |-- sync-request ---------------------->|
  |                               |                           |           |
  | (client waits)                |<-- "unavailable" --------|           |
  |                               | pendingStorageChannels=  |           |
  |                               |   {s2}                   |           |
  |                               |                           |           |
  |                               |<-- sync-response with data ----------|
  |                               | Import data              |           |
  |                               | pendingStorageChannels={}|           |
  |                               | Process queued requests  |           |
  |                               |                           |           |
  |<-- sync-response with data --|                           |           |
```

### Implementation Details

**handleSyncRequest from network:**
```typescript
// In handle-sync-request.ts
if (!docState && storageChannelIds.length > 0) {
  // 1. Create doc with pending state
  docState = createDocState({ docId })
  docState.pendingStorageChannels = new Set(storageChannelIds)
  docState.pendingNetworkRequests = [{ channelId: fromChannelId, requesterDocVersion }]
  model.documents.set(docId, docState)
  
  // 2. Add peer to subscriptions (for future updates)
  addPeerSubscription(peerState, docId)
  
  // 3. Ask ALL storage adapters if they have this doc
  return {
    type: "cmd/send-sync-request",
    toChannelIds: storageChannelIds,
    docs: [{ docId, requesterDocVersion: new VersionVector(null) }],
    bidirectional: false,
  }
  
  // NOTE: No response to network yet!
}
```

**handleSyncResponse from storage:**
```typescript
// In handle-sync-response.ts
if (docState.pendingStorageChannels?.has(fromChannelId)) {
  // 1. Remove this storage from pending set
  docState.pendingStorageChannels.delete(fromChannelId)
  
  // 2. Import data if any
  if (transmission.type === "update" || transmission.type === "snapshot") {
    // Import happens via existing cmd/import-doc-data
  }
  
  // 3. If ALL storage has responded, process pending network requests
  if (docState.pendingStorageChannels.size === 0) {
    const commands = docState.pendingNetworkRequests.map(req => ({
      type: "cmd/send-sync-response",
      toChannelId: req.channelId,
      docId,
      requesterDocVersion: req.requesterDocVersion,
    }))
    docState.pendingNetworkRequests = []
    return batchAsNeeded(...commands)
  }
}
```

**Timeout handling:**
```typescript
// Could use heartbeat or a new timer command
// After 10s, if pendingStorageChannels is not empty:
// - Clear pendingStorageChannels
// - Process pendingNetworkRequests with current state
```

### Edge Cases

**Network peer disconnects while waiting:**
- When channel is removed, clean up any pending requests for that channel
- Other pending requests continue waiting

**More network requests arrive while waiting:**
- Add them to `pendingNetworkRequests` array
- They all get processed together when storage responds

**Storage adapter added after network request:**
- Only storage adapters present at request time are consulted
- New adapters don't affect pending requests

**Document already exists when network request arrives:**
- Normal flow - respond immediately with current data
- No pending state needed

## Dependency Analysis

### Direct Dependencies

| File | Change | Impact |
|------|--------|--------|
| `types.ts` | Add `pendingStorageChannels` and `pendingNetworkRequests` to `DocState` | Type change |
| `handle-sync-request.ts` | Queue network requests, ask storage | Core logic |
| `handle-sync-response.ts` | Track storage responses, process queue | Core logic |
| `handle-channel-removed.ts` | Clean up pending requests on disconnect | Edge case |

### Transitive Dependencies

| Consumer | Depends On | Impact |
|----------|------------|--------|
| `createDocState()` | `DocState` type | Must initialize new fields |
| `handle.ts` | No change | `waitForSync()` works as-is |
| Storage adapter | No change | Already responds with "unavailable" |
| Network adapters | No change | Just see delayed response |

### Risk Assessment

- **Low risk**: No protocol changes
- **Low risk**: New fields in DocState are additive
- **Medium risk**: Need to handle edge cases (disconnect, timeout)
- **Testing risk**: Need to test multi-storage scenarios

## Implementation Plan

### Phase 1: Type Changes

1. Add `pendingStorageChannels: Set<ChannelId>` to `DocState` in `types.ts`
2. Add `pendingNetworkRequests: Array<{channelId, requesterDocVersion}>` to `DocState`
3. Update `createDocState()` to initialize new fields as empty

### Phase 2: Sync-Request Handling

1. Modify `handle-sync-request.ts`:
   - Get list of storage channel IDs from model
   - If doc doesn't exist AND has storage adapters:
     - Create doc with pending state
     - Queue the network request
     - Send sync-request to ALL storage adapters
     - Return (no response to network yet)

### Phase 3: Sync-Response Handling

1. Modify `handle-sync-response.ts`:
   - Check if `fromChannelId` is in `pendingStorageChannels`
   - Remove from set
   - If set is now empty, process all `pendingNetworkRequests`

### Phase 4: Edge Case Handling

1. Modify `handle-channel-removed.ts`:
   - If removed channel is in any doc's `pendingStorageChannels`, remove it
   - If that empties the set, process pending requests
   - If removed channel has pending requests, remove them

2. Add timeout handling (via heartbeat or timer command)

### Phase 5: Testing

1. Test: Network request for unknown doc with one storage → waits, then responds
2. Test: Network request for unknown doc with multiple storage → waits for all
3. Test: Storage has data → network gets data
4. Test: Storage doesn't have data → network gets "unavailable"
5. Test: Network disconnects while waiting → cleanup
6. Test: Multiple network requests while waiting → all get response
7. Test: Timeout → responds with current state

### Phase 6: Documentation

1. Update `synchronizer.md` with storage-first sync documentation
2. Document the queue-based approach

## Files to Modify

1. `packages/repo/src/types.ts` - Add pending fields to DocState
2. `packages/repo/src/synchronizer/sync/handle-sync-request.ts` - Queue logic
3. `packages/repo/src/synchronizer/sync/handle-sync-response.ts` - Process queue
4. `packages/repo/src/synchronizer/connection/handle-channel-removed.ts` - Cleanup
5. `packages/repo/src/tests/storage-first-sync.test.ts` - New test file

## Open Questions (Resolved)

1. ~~Should we wait for ALL storage adapters or ONE?~~
   - **Answer**: ALL - any storage might have the document

2. ~~Is a simple boolean sufficient?~~
   - **Answer**: No, use `Set<ChannelId>` to track which storage adapters we're waiting for

3. ~~Should we add a "pending" transmission type?~~
   - **Answer**: No - simpler to just not respond until ready

## Lazy Loading (IMPLEMENTED ✅)

We removed the `requestStoredDocuments()` call from `StorageAdapter.handleEstablishRequest()`.

**Before (eager loading):**
```typescript
// StorageAdapter.handleEstablishRequest()
private async handleEstablishRequest(): Promise<void> {
  this.reply({ type: "channel/establish-response", ... })
  await this.requestStoredDocuments()  // Loaded ALL docs on startup
}
```

**After (lazy loading):**
```typescript
// StorageAdapter.handleEstablishRequest()
private async handleEstablishRequest(): Promise<void> {
  this.reply({ type: "channel/establish-response", ... })
  // Storage is now lazy - documents are loaded on-demand via handleSyncRequest
}
```

**Benefits:**
1. Scales to millions of documents
2. Reduces startup time
3. Avoids race conditions with eager loading
4. Memory efficient - only loads requested documents

**How it works:**
- Storage doesn't send sync-requests on startup
- When a network client requests a doc, we ask storage (storage-first sync)
- Storage loads on-demand via `handleSyncRequest` and responds
- Documents stay in storage until requested (this is fine!)
- Server-side operations can call `repo.getHandle(docId)` which triggers storage-first flow
